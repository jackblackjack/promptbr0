import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell, Tray, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from "electron";
import { z } from "zod";
import {
  backupDatabase,
  latestBackup,
  openDatabase,
  PromptLibrary,
  resolveDatabasePath,
  type Database,
  type PromptRow,
} from "@promptbr0/core";
import {
  IPC_CHANNELS,
  aiAssistSchema,
  aiJudgeSchema,
  aiModelHideSchema,
  aiModelsSetSchema,
  aiProviderConnectEnvSchema,
  aiProviderCreateSchema,
  aiProviderTestSchema,
  aiProviderUpdateSchema,
  aiRunCancelSchema,
  aiRunSchema,
  branchCreateSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  collectionMoveSchema,
  collectionPromptSchema,
  collectionPathSchema,
  draftSetSchema,
  markdownConfirmSchema,
  markdownDiscardSchema,
  markdownImportPreviewDtoSchema,
  markdownImportResultDtoSchema,
  markdownPreviewSchema,
  noteAddSchema,
  promptCreateSchema,
  promptDuplicateSchema,
  promptListSchema,
  promptBakeBlocksSchema,
  promptSetBlocksSchema,
  promptUpdateSchema,
  ratingAddSchema,
  ratingAveragesSchema,
  recentActivitySchema,
  runAddSchema,
  runUpdateMetricsSchema,
  runUpdateOutcomeSchema,
  searchSchema,
  setLanguageSchema,
  syncForgetDeviceSchema,
  syncPairWithCodeSchema,
  syncRespondPairingSchema,
  syncSetDeviceNameSchema,
  syncSetEnabledSchema,
  syncSetListenPortSchema,
  suggestionApproveSchema,
  suggestionRejectSchema,
  tagCreateSchema,
  tagOnPromptSchema,
  tagDeleteSchema,
  traySettingsSchema,
  updateOpenDownloadSchema,
  updateSetAutomaticChecksSchema,
  updateStateDtoSchema,
  versionCreateSchema,
  versionDeleteSchema,
  versionSetCurrentSchema,
  versionUpdateContentSchema,
  versionUpdateLabelSchema,
  type ActivityItemDto,
  type BranchCreateResult,
  type FileOpResult,
  type ImportResult,
  type LibraryStats,
  type MarkdownImportPreviewDto,
  type MarkdownImportResultDto,
  type PromptDetail,
  type RatingSummaryDto,
  type SuggestionDto,
  type TagDto,
} from "../shared/ipc.js";
import {
  toBranchDto,
  toCollectionDto,
  toNoteDto,
  toPromptBlocks,
  toPromptSummary,
  toRatingDto,
  toRunDto,
  toSuggestionDto,
  toTagDto,
  toTreeDto,
  toVersionDto,
  versionLabel,
} from "./mappers.js";
import {
  connectEnvProvider as aiConnectEnvProvider,
  cancelRunGroup,
  createProvider as aiCreateProvider,
  detectEnvKeys,
  getCatalog as aiGetCatalog,
  judgeRunGroup,
  listProviders as aiListProviders,
  providerTypesInfo,
  refreshCatalog as aiRefreshCatalog,
  runAssist,
  runModelGroup,
  setModelHidden as aiSetModelHidden,
  testProvider as aiTestProvider,
  toAiProviderDto,
  updateProvider as aiUpdateProvider,
  type AiServiceDeps,
  type KeyCipher,
} from "./ai.js";
import { createImportDispatcher, deepLinkFromArgv, parseImportDeepLink } from "./deep-link.js";
import { assertAuthorizedMainFrame, MarkdownImportService } from "./markdown-import.js";
import {
  createDailyBackupScheduler,
  type DailyBackupScheduler,
} from "./backup-scheduler.js";
import { configureLinuxDisplayBackend } from "./linux-display.js";
import { loadMenuIcons, loadTrayIcon } from "./menu-icons.js";
import { logRendererConsoleMessage } from "./logger.js";
import { createBeforeQuitHandler, createWillQuitHandler } from "./shutdown.js";
import {
  createMainWindowCloseHandler,
  createMainWindowClosedHandler,
  restoreOrCreateMainWindow,
  shouldQuitWhenMainWindowCloses,
} from "./main-window.js";
import { applyQaUserDataOverride } from "./qa-profile.js";
import { DesktopSync } from "./sync/service.js";
import { UpdateService } from "./updates.js";
import { scheduleAutomaticUpdateCheck } from "./update-startup.js";
import {
  createQuickPaletteController,
  QUICK_PALETTE_SETTINGS_KEY,
  quickPaletteWindowOptions,
  registerQuickPaletteIpcHandlers,
  type QuickPaletteController,
  type QuickPaletteWindowHandlers,
  type QuickPaletteWindowPort,
} from "./quick-palette.js";
import {
  createTrayController,
  type TrayController,
  type TrayPort,
} from "./tray.js";

/**
 * API keys are encrypted with the OS keychain before storage. When the
 * platform offers no encryption (e.g. some Linux sessions), we refuse to
 * store keys at all rather than persisting them in plaintext.
 */
const keyCipher: KeyCipher = {
  encrypt(plaintext) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS keychain encryption is unavailable — cannot store API keys safely");
    }
    return safeStorage.encryptString(plaintext).toString("base64");
  },
  decrypt(blob) {
    return safeStorage.decryptString(Buffer.from(blob, "base64"));
  },
};

// Injected by electron-vite at build time (see electron.vite.config.ts) so the
// footer always shows the app version, never Electron's.
declare const __APP_VERSION__: string;

// Electron's native Wayland path can load the renderer without ever presenting
// a window on virtual GPUs. X11/Xwayland is the reliable Linux default, while
// an explicit --ozone-platform choice remains available to users.
configureLinuxDisplayBackend(process.platform, app.commandLine);

// Dev runs launch the bare `electron` binary, so the app name (macOS menu
// bar, Dock tooltip, window title fallback) defaults to "Electron" unless it
// is set explicitly, as early as possible.
app.setName("PromptBr0");
applyQaUserDataOverride(app);

// Deep links (promptbr0://import-markdown?url=…). Packaged builds also declare the
// scheme via electron-builder `protocols` in package.json; dev registers the
// bare Electron binary — expected, dev-only.
app.setAsDefaultProtocolClient("promptbr0");

/**
 * Deep-link import dispatcher. Sends only to a renderer that finished
 * loading; otherwise queues (latest wins) and creates a window when none
 * exists, so a link clicked while the app runs windowless on macOS is not
 * silently deferred. `createWindow` is a hoisted declaration, and
 * `mainWindow` is read at call time — both safe to reference here.
 * open-url can fire before `ready`, so window creation is guarded on
 * app.isReady(); a queued pre-ready link flushes via the window created in
 * whenReady.
 */
const importDispatcher = createImportDispatcher<BrowserWindow>({
  getWindow: () => mainWindow,
  createWindow: () => {
    if (app.isReady() && !mainWindow) createWindow();
  },
  send: (window, intent) => {
    window.webContents.send(IPC_CHANNELS.markdownOpenImport, intent.url);
  },
  // A hidden (close-to-tray) window must come back before the import dialog
  // can be seen; showMainWindow also restores the macOS Dock icon.
  focus: () => showMainWindow(),
});

// macOS delivers deep links via open-url, possibly before `ready` — this
// listener must be registered at module load, not inside whenReady.
app.on("open-url", (event, url) => {
  event.preventDefault();
  const intent = parseImportDeepLink(url);
  if (intent) importDispatcher.dispatch(intent);
});

let db: Database | null = null;
let library: PromptLibrary | null = null;
let backupsDir: string | null = null;
let backupScheduler: DailyBackupScheduler | null = null;
let desktopSync: DesktopSync | null = null;
let updateService: UpdateService | null = null;
let markdownImportService: MarkdownImportService | null = null;
let quickPaletteController: QuickPaletteController | null = null;
let trayController: TrayController | null = null;
let updateStartupTimer: NodeJS.Timeout | null = null;
let syncPokeTimer: NodeJS.Timeout | null = null;
// Set as soon as a real quit starts (menu, Cmd+Q, OS shutdown) so the
// close-to-tray handler stops intercepting window closes.
let isQuitting = false;

function getDb(): Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}

function getLibrary(): PromptLibrary {
  if (!library) throw new Error("Library not initialized");
  return library;
}

function getDesktopSync(): DesktopSync {
  if (!desktopSync) throw new Error("Sync service not initialized");
  return desktopSync;
}

function getUpdateService(): UpdateService {
  if (!updateService) throw new Error("Update service not initialized");
  return updateService;
}

function getMarkdownImportService(): MarkdownImportService {
  if (!markdownImportService) throw new Error("Markdown import service not initialized");
  return markdownImportService;
}

function getTrayController(): TrayController {
  if (!trayController) throw new Error("Tray controller not initialized");
  return trayController;
}

const idParam = z.string().trim().min(1).max(200);

function tagsForPrompt(promptId: string): TagDto[] {
  return (
    getDb()
      .prepare(
        `SELECT t.* FROM tags t JOIN prompt_tags pt ON pt.tag_id = t.id
         WHERE pt.prompt_id = ? ORDER BY t.name COLLATE NOCASE ASC`,
      )
      .all(promptId) as Array<{ id: string; name: string; color: string | null }>
  ).map((t) => toTagDto({ ...t }));
}

function currentVersionLabelFor(prompt: PromptRow): string | null {
  if (!prompt.current_version_id) return null;
  const row = getDb()
    .prepare(
      `SELECT v.number, v.label, b.name AS branch_name
       FROM versions v JOIN branches b ON b.id = v.branch_id WHERE v.id = ?`,
    )
    .get(prompt.current_version_id) as { number: number; label: string | null; branch_name: string } | undefined;
  return row ? versionLabel(row, row.branch_name) : null;
}

function toDetail(prompt: PromptRow): PromptDetail {
  const lib = getLibrary();
  return {
    ...toPromptSummary(prompt, tagsForPrompt(prompt.id), currentVersionLabelFor(prompt)),
    currentVersionId: prompt.current_version_id,
    draftContent: prompt.draft_content,
    draftBaseVersionId: prompt.draft_base_version_id,
    blocks: toPromptBlocks(prompt),
    collectionIds: lib.listCollectionIdsForPrompt(prompt.id),
  };
}

/** Resolves a version id to its display label (for notes/runs DTOs). */
function versionLabelFor(versionId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT v.number, v.label, b.name AS branch_name
       FROM versions v JOIN branches b ON b.id = v.branch_id WHERE v.id = ?`,
    )
    .get(versionId) as { number: number; label: string | null; branch_name: string } | undefined;
  return row ? versionLabel(row, row.branch_name) : null;
}

function writeBackup(): string {
  if (!backupsDir) throw new Error("Backups directory not initialized");
  const backupPath = backupDatabase(getDb(), backupsDir, 10);
  console.log(`[main] backup written: ${backupPath}`);
  return backupPath;
}

function runBackupNow(): string {
  const backupPath = writeBackup();
  backupScheduler?.backupCompleted();
  return backupPath;
}

function registerIpcHandlers(): void {
  const lib = getLibrary();
  markdownImportService = new MarkdownImportService({ lib });

  // -------------------------------------------------------------- prompts
  ipcMain.handle(IPC_CHANNELS.promptList, (_e, payload: unknown) => {
    const query = promptListSchema.parse(payload ?? {});
    return lib
      .listPrompts(query)
      .map((row) => toPromptSummary(row, tagsForPrompt(row.id), currentVersionLabelFor(row), lib.listCollectionIdsForPrompt(row.id)));
  });

  ipcMain.handle(IPC_CHANNELS.promptGet, (_e, payload: unknown) => {
    const prompt = lib.getPrompt(idParam.parse(payload));
    return prompt ? toDetail(prompt) : null;
  });

  ipcMain.handle(IPC_CHANNELS.promptCreate, (_e, payload: unknown) => {
    const input = promptCreateSchema.parse(payload);
    const prompt = lib.createPrompt(input);
    console.log(`[main] created prompt ${prompt.id} (${prompt.title})`);
    return toDetail(prompt);
  });

  ipcMain.handle(IPC_CHANNELS.promptDuplicate, (_e, payload: unknown) => {
    const input = promptDuplicateSchema.parse(payload);
    const prompt = lib.duplicatePrompt(input);
    console.log(`[main] duplicated prompt ${input.promptId} as ${prompt.id} (${prompt.title})`);
    return toDetail(prompt);
  });

  ipcMain.handle(IPC_CHANNELS.promptUpdate, (_e, payload: unknown) => {
    const { id, patch } = promptUpdateSchema.parse(payload);
    return toDetail(lib.updatePromptMetadata(id, patch));
  });

  ipcMain.handle(IPC_CHANNELS.promptSetBlocks, (_e, payload: unknown) => {
    const { promptId, blocks } = promptSetBlocksSchema.parse(payload);
    return toDetail(lib.setPromptBlocks(promptId, blocks));
  });

  ipcMain.handle(IPC_CHANNELS.promptBakeBlocks, (_e, payload: unknown) => {
    const input = promptBakeBlocksSchema.parse(payload);
    const { version, blocks } = lib.bakeBlocksIntoNewVersion(input);
    const prompt = lib.getPrompt(input.promptId);
    return {
      version: toVersionDto(version, branchNameFor(version.branch_id), prompt?.current_version_id ?? null),
      blocks: toPromptBlocks({ blocks_json: blocks.length ? JSON.stringify({ v: 1, blocks }) : null }),
    };
  });

  ipcMain.handle(IPC_CHANNELS.promptSetStarred, (_e, payload: unknown) => {
    const { id, starred } = z.object({ id: idParam, starred: z.boolean() }).parse(payload);
    lib.setStarred(id, starred);
  });

  ipcMain.handle(IPC_CHANNELS.promptSoftDelete, (_e, payload: unknown) => {
    lib.softDeletePrompt(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.promptRestore, (_e, payload: unknown) => {
    lib.restorePrompt(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.promptHardDelete, (_e, payload: unknown) => {
    lib.hardDeletePrompt(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.promptExport, async (event, payload: unknown): Promise<FileOpResult> => {
    const promptId = idParam.parse(payload);
    const prompt = lib.getPrompt(promptId);
    if (!prompt) throw new Error(`Prompt not found: ${promptId}`);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("Cannot show a save dialog without a window");
    const result = await dialog.showSaveDialog(win, {
      title: "Export prompt",
      defaultPath: `${prompt.title.replace(/[^\w.-]+/g, "-").toLowerCase()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const bundle = {
      meta: { formatVersion: 1 as const, exportedAt: new Date().toISOString(), kind: "prompt" },
      prompt: toDetail(prompt),
      versions: lib.listVersions(promptId),
      notes: lib.listNotes(promptId),
      runs: lib.listRuns(promptId),
    };
    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), "utf8");
    return { canceled: false, path: result.filePath };
  });

  // ------------------------------------------------------------- versions
  ipcMain.handle(IPC_CHANNELS.versionCreate, (_e, payload: unknown) => {
    const input = versionCreateSchema.parse(payload);
    const version = lib.createVersion(input);
    const prompt = lib.getPrompt(input.promptId);
    return toVersionDto(version, branchNameFor(version.branch_id), prompt?.current_version_id ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.versionList, (_e, payload: unknown) => {
    const promptId = idParam.parse(payload);
    const prompt = lib.getPrompt(promptId);
    return lib
      .listVersions(promptId)
      .map((v) => toVersionDto(v, v.branch_name, prompt?.current_version_id ?? null));
  });

  ipcMain.handle(IPC_CHANNELS.versionGet, (_e, payload: unknown) => {
    const versionId = idParam.parse(payload);
    const version = lib.getVersion(versionId);
    if (!version) return null;
    const prompt = lib.getPrompt(version.prompt_id);
    const branchName = branchNameFor(version.branch_id);
    return { ...toVersionDto(version, branchName, prompt?.current_version_id ?? null), content: version.content, contentFormat: version.content_format };
  });

  ipcMain.handle(IPC_CHANNELS.versionSetCurrent, (_e, payload: unknown) => {
    const { promptId, versionId } = versionSetCurrentSchema.parse(payload);
    lib.setCurrentVersion(promptId, versionId);
  });

  ipcMain.handle(IPC_CHANNELS.versionUpdateContent, (_e, payload: unknown) => {
    const { versionId, content } = versionUpdateContentSchema.parse(payload);
    const version = lib.updateVersionContent(versionId, content);
    const prompt = lib.getPrompt(version.prompt_id);
    return toVersionDto(version, branchNameFor(version.branch_id), prompt?.current_version_id ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.versionUpdateLabel, (_e, payload: unknown) => {
    const { versionId, label } = versionUpdateLabelSchema.parse(payload);
    const version = lib.updateVersionLabel(versionId, label);
    const prompt = lib.getPrompt(version.prompt_id);
    return toVersionDto(version, branchNameFor(version.branch_id), prompt?.current_version_id ?? null);
  });

  ipcMain.handle(IPC_CHANNELS.versionDelete, (_e, payload: unknown) => {
    const { versionId } = versionDeleteSchema.parse(payload);
    lib.deleteVersion(versionId);
  });

  function branchNameFor(branchId: string): string {
    const row = getDb().prepare("SELECT name FROM branches WHERE id = ?").get(branchId) as
      | { name: string }
      | undefined;
    return row?.name ?? "main";
  }

  // --------------------------------------------------------------- drafts
  ipcMain.handle(IPC_CHANNELS.draftGet, (_e, payload: unknown) => {
    return lib.getDraft(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.draftSet, (_e, payload: unknown) => {
    const input = draftSetSchema.parse(payload);
    lib.setDraft(input.promptId, input.content, "baseVersionId" in input ? input.baseVersionId : undefined);
  });

  // -------------------------------------------------------------- branches
  ipcMain.handle(IPC_CHANNELS.branchList, (_e, payload: unknown) => {
    return lib.listBranches(idParam.parse(payload)).map(toBranchDto);
  });

  ipcMain.handle(IPC_CHANNELS.branchCreate, (_e, payload: unknown): BranchCreateResult => {
    const input = branchCreateSchema.parse(payload);
    const { branch, version } = lib.createBranch(input);
    const prompt = lib.getPrompt(input.promptId);
    console.log(`[main] created branch "${branch.name}" on prompt ${input.promptId}`);
    return {
      branch: toBranchDto(branch),
      version: toVersionDto(version, branch.name, prompt?.current_version_id ?? null),
    };
  });

  // ----------------------------------------------------------- suggestions
  ipcMain.handle(IPC_CHANNELS.suggestionList, (): SuggestionDto[] =>
    lib.listSuggestions().map(toSuggestionDto),
  );

  ipcMain.handle(IPC_CHANNELS.suggestionApprove, (_e, payload: unknown) => {
    const { versionId, setAsCurrent } = suggestionApproveSchema.parse(payload);
    lib.approveSuggestion(versionId, { setAsCurrent: setAsCurrent ?? false });
    console.log(`[main] approved suggestion ${versionId}${setAsCurrent ? " (set as current)" : ""}`);
  });

  ipcMain.handle(IPC_CHANNELS.suggestionReject, (_e, payload: unknown) => {
    const { versionId } = suggestionRejectSchema.parse(payload);
    lib.rejectSuggestion(versionId);
    console.log(`[main] rejected suggestion ${versionId}`);
  });

  // ----------------------------------------------------------------- notes
  ipcMain.handle(IPC_CHANNELS.noteAdd, (_e, payload: unknown) => {    const note = lib.addNote(noteAddSchema.parse(payload));
    return toNoteDto(note, versionLabelFor);
  });

  ipcMain.handle(IPC_CHANNELS.noteList, (_e, payload: unknown) => {
    return lib.listNotes(idParam.parse(payload)).map((n) => toNoteDto(n, versionLabelFor));
  });

  ipcMain.handle(IPC_CHANNELS.noteDelete, (_e, payload: unknown) => {
    lib.deleteNote(idParam.parse(payload));
  });

  // ------------------------------------------------------------------ tags
  ipcMain.handle(IPC_CHANNELS.tagCreate, (_e, payload: unknown) => {
    return toTagDto(lib.createTag(tagCreateSchema.parse(payload)));
  });

  ipcMain.handle(IPC_CHANNELS.tagList, () => lib.listTags().map(toTagDto));

  ipcMain.handle(IPC_CHANNELS.tagAddToPrompt, (_e, payload: unknown) => {
    const { promptId, tagId } = tagOnPromptSchema.parse(payload);
    lib.addTagToPrompt(promptId, tagId);
  });

  ipcMain.handle(IPC_CHANNELS.tagRemoveFromPrompt, (_e, payload: unknown) => {
    const { promptId, tagId } = tagOnPromptSchema.parse(payload);
    lib.removeTagFromPrompt(promptId, tagId);
  });

  ipcMain.handle(IPC_CHANNELS.tagDelete, (_e, payload: unknown) => {
    lib.deleteTag(tagDeleteSchema.parse(payload).id);
  });

  // ------------------------------------------------------------ collections
  ipcMain.handle(IPC_CHANNELS.collectionCreate, (_e, payload: unknown) => {
    const input = collectionCreateSchema.parse(payload);
    return toCollectionDto(lib.createCollection({ name: input.name, parentCollectionId: input.parentCollectionId ?? null }));
  });

  ipcMain.handle(IPC_CHANNELS.collectionUpdate, (_e, payload: unknown) => {
    const { id, patch } = collectionUpdateSchema.parse(payload);
    lib.updateCollection(id, {
      name: patch.name,
      parentCollectionId: patch.parentCollectionId ?? null,
      sortOrder: patch.sortOrder,
    });
  });

  ipcMain.handle(IPC_CHANNELS.collectionMove, (_e, payload: unknown) => {
    const input = collectionMoveSchema.parse(payload);
    lib.moveCollection(input);
  });

  ipcMain.handle(IPC_CHANNELS.collectionDelete, (_e, payload: unknown) => {
    lib.deleteCollection(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.collectionTree, () => {
    const tree = lib.getCollectionTree();
    return toTreeDto(tree);
  });

  ipcMain.handle(IPC_CHANNELS.collectionByParent, (_e, payload: unknown) => {
    const { parentId } = z.object({ parentId: z.string().nullable() }).parse(payload);
    return lib.listCollectionsByParent(parentId).map(toCollectionDto);
  });

  ipcMain.handle(IPC_CHANNELS.collectionList, () => lib.listCollections().map(toCollectionDto));

  ipcMain.handle(IPC_CHANNELS.collectionAddPrompt, (_e, payload: unknown) => {
    const { collectionId, promptId } = collectionPromptSchema.parse(payload);
    lib.addPromptToCollection(collectionId, promptId);
  });

  ipcMain.handle(IPC_CHANNELS.collectionRemovePrompt, (_e, payload: unknown) => {
    const { collectionId, promptId } = collectionPromptSchema.parse(payload);
    lib.removePromptFromCollection(collectionId, promptId);
  });

  ipcMain.handle(IPC_CHANNELS.collectionForPrompt, (_e, payload: unknown) => {
    return lib.listCollectionIdsForPrompt(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.collectionPath, (_e, payload: unknown) => {
    const { collectionId } = collectionPathSchema.parse(payload);
    return lib.getCollectionPath(collectionId).map((b) => ({
      id: b.id,
      name: b.name,
      parentId: b.parent_collection_id,
    }));
  });

  // ---------------------------------------------------------------- search
  ipcMain.handle(IPC_CHANNELS.search, (_e, payload: unknown) => {
    const { query } = searchSchema.parse(payload);
    return lib.search(query).map((r) => ({ promptId: r.promptId, title: r.title, snippet: r.snippet }));
  });

  // ------------------------------------------------------- ratings and runs
  ipcMain.handle(IPC_CHANNELS.ratingAdd, (_e, payload: unknown) => {
    const input = ratingAddSchema.parse(payload);
    // Ratings have a polymorphic target (no FK) — validate existence here.
    const exists =
      input.targetType === "prompt" ? lib.getPrompt(input.targetId) : lib.getVersion(input.targetId);
    if (!exists) throw new Error(`${input.targetType} not found: ${input.targetId}`);
    return toRatingDto(lib.addRating(input));
  });

  ipcMain.handle(IPC_CHANNELS.ratingLatest, (_e, payload: unknown) => {
    const { targetType, targetId } = ratingAveragesSchema.parse(payload);
    const rating = lib.getLatestRating(targetType, targetId);
    return rating ? toRatingDto(rating) : null;
  });

  ipcMain.handle(IPC_CHANNELS.ratingAverages, (_e, payload: unknown) => {
    const { targetType, targetId } = ratingAveragesSchema.parse(payload);
    return lib.getAverageRatings(targetType, targetId);
  });

  ipcMain.handle(IPC_CHANNELS.ratingVersionSummaries, (_e, payload: unknown) => {
    const promptId = idParam.parse(payload);
    const result: Record<string, RatingSummaryDto> = {};
    for (const { version_id, ...summary } of lib.getVersionRatingSummaries(promptId)) {
      result[version_id] = summary;
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.runAdd, (_e, payload: unknown) => {
    const input = runAddSchema.parse(payload);
    return toRunDto(lib.addRun(input), versionLabelFor);
  });

  ipcMain.handle(IPC_CHANNELS.runDelete, (_e, payload: unknown) => {
    lib.deleteRun(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.runList, (_e, payload: unknown) => {
    return lib.listRuns(idParam.parse(payload)).map((r) => toRunDto(r, versionLabelFor));
  });

  ipcMain.handle(IPC_CHANNELS.runUpdateOutcome, (_e, payload: unknown) => {
    const { runId, outcomeRating } = runUpdateOutcomeSchema.parse(payload);
    return toRunDto(lib.updateRunOutcome(runId, outcomeRating), versionLabelFor);
  });

  ipcMain.handle(IPC_CHANNELS.runUpdateMetrics, (_e, payload: unknown) => {
    const { runId, patch } = runUpdateMetricsSchema.parse(payload);
    return toRunDto(lib.updateRunMetrics(runId, patch), versionLabelFor);
  });

  // --------------------------------------------------------------------- ai
  const aiDeps: AiServiceDeps = { lib, cipher: keyCipher };

  ipcMain.handle(IPC_CHANNELS.aiProviderTypes, () => providerTypesInfo());

  ipcMain.handle(IPC_CHANNELS.aiProviderCreate, (_e, payload: unknown) => {
    const provider = aiCreateProvider(aiDeps, aiProviderCreateSchema.parse(payload));
    console.log(`[main] created AI provider ${provider.id} (${provider.type}: ${provider.name})`);
    return provider;
  });

  ipcMain.handle(IPC_CHANNELS.aiProviderUpdate, (_e, payload: unknown) => {
    return aiUpdateProvider(aiDeps, aiProviderUpdateSchema.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.aiProviderDelete, (_e, payload: unknown) => {
    lib.deleteProvider(idParam.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.aiProviderList, () => aiListProviders(aiDeps));

  ipcMain.handle(IPC_CHANNELS.aiProviderTest, (_e, payload: unknown) => {
    const { providerId, modelId } = aiProviderTestSchema.parse(payload);
    return aiTestProvider(aiDeps, providerId, modelId);
  });

  ipcMain.handle(IPC_CHANNELS.aiModelsSet, (_e, payload: unknown) => {
    const { providerId, models } = aiModelsSetSchema.parse(payload);
    lib.setProviderModels(providerId, models);
    return toAiProviderDto(lib, lib.getProvider(providerId)!);
  });

  ipcMain.handle(IPC_CHANNELS.aiModelHide, (_e, payload: unknown) => {
    return aiSetModelHidden(aiDeps, aiModelHideSchema.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.aiEnvDetect, () => detectEnvKeys(lib));

  ipcMain.handle(IPC_CHANNELS.aiProviderConnectEnv, (_e, payload: unknown) => {
    return aiConnectEnvProvider(aiDeps, aiProviderConnectEnvSchema.parse(payload));
  });

  // Catalog handlers never throw: get returns null when empty/corrupt,
  // refresh reports failure and keeps serving the stale cache (offline-safe).
  ipcMain.handle(IPC_CHANNELS.aiCatalogGet, () => aiGetCatalog(lib));

  ipcMain.handle(IPC_CHANNELS.aiCatalogRefresh, () => aiRefreshCatalog(aiDeps));

  ipcMain.handle(IPC_CHANNELS.aiRun, async (_e, payload: unknown) => {
    const input = aiRunSchema.parse(payload);
    const group = await runModelGroup(aiDeps, input, (event) => {
      // Live progress side channel; the invoke still resolves with the
      // final group once every model settled.
      mainWindow?.webContents.send(IPC_CHANNELS.aiRunProgress, event);
    });
    console.log(
      `[main] ai:run group ${group.runGroupId} on prompt ${input.promptId}: ` +
        group.runs.map((r) => `${r.modelId}=${r.status}`).join(", "),
    );
    return group;
  });

  ipcMain.handle(IPC_CHANNELS.aiRunCancel, (_e, payload: unknown) => {
    const { runGroupId } = aiRunCancelSchema.parse(payload);
    const cancelled = cancelRunGroup(runGroupId);
    console.log(`[main] ai:run-cancel ${runGroupId}: ${cancelled ? "aborted" : "not in flight"}`);
    return { cancelled };
  });

  ipcMain.handle(IPC_CHANNELS.aiAssist, (_e, payload: unknown) => {
    return runAssist(aiDeps, aiAssistSchema.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.aiJudge, (_e, payload: unknown) => {
    return judgeRunGroup(aiDeps, aiJudgeSchema.parse(payload));
  });

  ipcMain.handle(IPC_CHANNELS.runGroupList, (_e, payload: unknown) => {
    return lib.listRunGroups(idParam.parse(payload));
  });

  // ------------------------------------------------------ Markdown import
  ipcMain.handle(
    IPC_CHANNELS.markdownPreview,
    async (event, payload: unknown): Promise<MarkdownImportPreviewDto> => {
      const senderId = assertAuthorizedMainFrame(event, mainWindow);
      const { url } = markdownPreviewSchema.parse(payload);
      const preview = await getMarkdownImportService().preview(url, senderId);
      return markdownImportPreviewDtoSchema.parse({
        previewId: preview.previewId,
        sourceUrl: preview.sourceUrl,
        finalUrl: preview.finalUrl,
        suggestedTitle: preview.suggestedTitle,
        content: preview.content,
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.markdownConfirm,
    (event, payload: unknown): MarkdownImportResultDto => {
      const senderId = assertAuthorizedMainFrame(event, mainWindow);
      const { previewId, title } = markdownConfirmSchema.parse(payload);
      const result = getMarkdownImportService().confirm(previewId, title, senderId);
      return markdownImportResultDtoSchema.parse({ promptId: result.promptId, title: result.title });
    },
  );

  ipcMain.handle(IPC_CHANNELS.markdownDiscard, (event, payload: unknown): void => {
    const senderId = assertAuthorizedMainFrame(event, mainWindow);
    const { previewId } = markdownDiscardSchema.parse(payload);
    getMarkdownImportService().discard(previewId, senderId);
  });

  // ------------------------------------------------------------------- sync
  const sync = getDesktopSync();

  ipcMain.handle(IPC_CHANNELS.syncGetStatus, () => sync.status());

  ipcMain.handle(IPC_CHANNELS.syncSetEnabled, async (_e, payload: unknown) => {
    const { enabled } = syncSetEnabledSchema.parse(payload);
    return sync.setEnabled(enabled);
  });

  ipcMain.handle(IPC_CHANNELS.syncSetDeviceName, (_e, payload: unknown) => {
    const { name } = syncSetDeviceNameSchema.parse(payload);
    return sync.setDeviceName(name);
  });

  ipcMain.handle(IPC_CHANNELS.syncSetListenPort, (_e, payload: unknown) => {
    const { port } = syncSetListenPortSchema.parse(payload);
    return sync.setListenPort(port);
  });

  ipcMain.handle(IPC_CHANNELS.syncBeginPairing, () => sync.beginPairing());

  ipcMain.handle(IPC_CHANNELS.syncCancelPairing, () => sync.cancelPairing());

  ipcMain.handle(IPC_CHANNELS.syncPairWithCode, async (_e, payload: unknown) => {
    const input = syncPairWithCodeSchema.parse(payload);
    return sync.pairWithCode(input.address, input.port, input.code);
  });

  ipcMain.handle(IPC_CHANNELS.syncRespondPairing, (_e, payload: unknown) => {
    const { requestId, accept } = syncRespondPairingSchema.parse(payload);
    sync.respondPairing(requestId, accept);
  });

  ipcMain.handle(IPC_CHANNELS.syncForgetDevice, (_e, payload: unknown) => {
    const { fingerprint } = syncForgetDeviceSchema.parse(payload);
    return sync.forgetDevice(fingerprint);
  });

  ipcMain.handle(IPC_CHANNELS.syncNow, () => sync.now());

  // --------------------------------------------------------------- library
  ipcMain.handle(IPC_CHANNELS.libraryStats, (): LibraryStats => {
    const count = (sql: string): number => (getDb().prepare(sql).get() as { c: number }).c;
    return {
      prompts: count("SELECT COUNT(*) AS c FROM prompts WHERE deleted_at IS NULL"),
      versions: count("SELECT COUNT(*) AS c FROM versions"),
      branches: count("SELECT COUNT(*) AS c FROM branches"),
      tags: count("SELECT COUNT(*) AS c FROM tags"),
      collections: count("SELECT COUNT(*) AS c FROM collections"),
      notes: count("SELECT COUNT(*) AS c FROM notes"),
      runs: count("SELECT COUNT(*) AS c FROM runs"),
    };
  });

  ipcMain.handle(IPC_CHANNELS.libraryExport, async (event): Promise<FileOpResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("Cannot show a save dialog without a window");
    const result = await dialog.showSaveDialog(win, {
      title: "Export library",
      defaultPath: `promptbr0-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(lib.exportLibrary(), null, 2), "utf8");
    console.log(`[main] library exported to ${result.filePath}`);
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle(IPC_CHANNELS.libraryImport, async (event): Promise<ImportResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error("Cannot show an open dialog without a window");
    const result = await dialog.showOpenDialog(win, {
      title: "Import library",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true };
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const summary = lib.importLibrary(raw);
    console.log(`[main] library imported from ${filePath}`);
    return { canceled: false, summary };
  });

  ipcMain.handle(IPC_CHANNELS.libraryBackupNow, () => runBackupNow());

  // Danger-zone op from Settings → Data & Backup: hard-delete every
  // soft-deleted prompt. Core exposes per-id hard delete only, so loop here.
  ipcMain.handle(IPC_CHANNELS.libraryEmptyTrash, () => {
    const trashed = lib.listPrompts({ deletedOnly: true });
    for (const prompt of trashed) lib.hardDeletePrompt(prompt.id);
    console.log(`[main] emptied trash (${trashed.length} prompts hard-deleted)`);
    return trashed.length;
  });

  ipcMain.handle(IPC_CHANNELS.libraryRecentActivity, (_e, payload: unknown): ActivityItemDto[] => {
    const { limit } = recentActivitySchema.parse(payload ?? {});
    return lib.listRecentActivity(limit ?? 50).map((item) => ({
      promptId: item.prompt_id,
      promptTitle: item.prompt_title,
      versionId: item.version_id,
      displayLabel: versionLabel({ number: item.number, label: item.label }, item.branch_name),
      branchName: item.branch_name,
      changeNote: item.change_note,
      createdAt: item.created_at,
    }));
  });

  // --------------------------------------------------------------- updates
  ipcMain.handle(IPC_CHANNELS.updateGetState, () =>
    updateStateDtoSchema.parse(getUpdateService().getState()),
  );

  ipcMain.handle(IPC_CHANNELS.updateCheck, async () =>
    updateStateDtoSchema.parse(await getUpdateService().check("manual")),
  );

  ipcMain.handle(IPC_CHANNELS.updateSetAutomaticChecks, (_event, payload: unknown) => {
    const { enabled } = updateSetAutomaticChecksSchema.parse(payload);
    const state = updateStateDtoSchema.parse(
      getUpdateService().setAutomaticChecksEnabled(enabled),
    );
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.updateOpenDownload, async (_event, payload: unknown) => {
    const { assetName } = updateOpenDownloadSchema.parse(payload);
    await getUpdateService().openDownload(assetName);
  });

  ipcMain.handle(IPC_CHANNELS.updateOpenReleaseNotes, async () => {
    await getUpdateService().openReleaseNotes();
  });

  // ------------------------------------------------------------------- app
  ipcMain.handle(IPC_CHANNELS.appInfo, () => {
    return {
      version: __APP_VERSION__,
      dbPath: dbPath ?? "",
      electronVersion: process.versions.electron ?? "",
      chromeVersion: process.versions.chrome ?? "",
      nodeVersion: process.versions.node ?? "",
    };
  });

  // Tray state is device-local and only the library window may change it;
  // the quick palette window has no settings surface.
  const assertLibraryWindow = (event: Electron.IpcMainInvokeEvent): void => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("Tray settings are only available from the library window.");
    }
  };

  ipcMain.handle(IPC_CHANNELS.trayGetState, (event) => {
    assertLibraryWindow(event);
    return getTrayController().getState();
  });

  ipcMain.handle(IPC_CHANNELS.traySetEnabled, (event, payload: unknown) => {
    assertLibraryWindow(event);
    const { enabled } = traySettingsSchema.parse(payload);
    return getTrayController().setEnabled(enabled);
  });

  // The tray menu follows the interface language; the renderer pushes changes
  // and main persists them so a relaunch starts with the right labels.
  ipcMain.handle(IPC_CHANNELS.appSetLanguage, (event, payload: unknown) => {
    assertLibraryWindow(event);
    const { language } = setLanguageSchema.parse(payload);
    getTrayController().setLanguage(language);
  });

  // Links in rendered Markdown previews open in the system browser. Only
  // http(s) URLs are allowed — never file:, javascript:, etc.
  ipcMain.handle(IPC_CHANNELS.openExternal, (_e, payload: unknown) => {
    const url = z.string().trim().url().max(2000).parse(payload);
    const protocol = new URL(url).protocol;
    if (protocol !== "https:" && protocol !== "http:") {
      throw new Error(`Refusing to open non-http(s) URL: ${protocol}//…`);
    }
    return shell.openExternal(url);
  });

  // The bundled third-party notices: an extraResource in packaged builds, the
  // monorepo root in dev checkouts. Served as text for the in-app licenses
  // dialog — the renderer never touches the filesystem itself.
  ipcMain.handle(IPC_CHANNELS.licensesText, () => {
    const candidates = [
      path.join(process.resourcesPath, "THIRD_PARTY_NOTICES.md"),
      path.resolve(app.getAppPath(), "..", "..", "THIRD_PARTY_NOTICES.md"),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) return Promise.reject(new Error("Third-party notices file not found"));
    return Promise.resolve(fs.readFileSync(file, "utf8"));
  });
}

let dbPath: string | null = null;
let mainWindow: BrowserWindow | null = null;
// True once the current window's first ready-to-show fired. A close-to-tray
// window is hidden only after that, so this distinguishes "hidden" from
// "still waiting for its first paint" (deep links may arrive that early).
let mainWindowPresented = false;

/**
 * Brings the library window back on screen. A hidden (close-to-tray) window is
 * neither destroyed nor minimized, so focus() alone would leave it invisible;
 * macOS also needs its Dock icon back while the tray owns the app.
 */
function showMainWindow(): void {
  if (process.platform === "darwin" && app.dock && !app.dock.isVisible()) {
    void app.dock.show();
  }
  // ready-to-show will present a freshly created window; showing it earlier
  // would flash an empty frame.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindowPresented) return;
  restoreOrCreateMainWindow(mainWindow, createWindow);
}

/**
 * Application menu. "About PromptBr0" asks the renderer to open the About
 * section of Settings (app:open-about) instead of Electron's native About
 * panel. The menu is built explicitly because the default would say "About
 * Electron" in dev.
 */
function installAppMenu(): void {
  const menuIcons = loadMenuIcons();
  const aboutItem: MenuItemConstructorOptions = {
    label: "About PromptBr0",
    ...(menuIcons.about ? { icon: menuIcons.about } : {}),
    click: () => mainWindow?.webContents.send(IPC_CHANNELS.openAbout),
  };
  const checkUpdatesItem: MenuItemConstructorOptions = {
    label: "Check for Updates…",
    ...(menuIcons.checkUpdates ? { icon: menuIcons.checkUpdates } : {}),
    click: () => mainWindow?.webContents.send(IPC_CHANNELS.openUpdates),
  };
  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    ...(menuIcons.settings ? { icon: menuIcons.settings } : {}),
    click: () => mainWindow?.webContents.send(IPC_CHANNELS.openSettings),
  };
  const openPaletteItem: MenuItemConstructorOptions = {
    label: "Open prompt palette",
    ...(menuIcons.promptPalette ? { icon: menuIcons.promptPalette } : {}),
    click: () => quickPaletteController?.toggle(),
  };
  const helpMenu: MenuItemConstructorOptions = {
    label: "Help",
    submenu: [openPaletteItem, { type: "separator" }, aboutItem, checkUpdatesItem, settingsItem],
  };

  // Win/Linux: the menu bar is auto-hidden (Alt reveals it); a slim Help
  // menu still carries the About and Settings entries there.
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([helpMenu]));
    return;
  }

  const isDev = !!process.env["ELECTRON_RENDERER_URL"];
  const template: MenuItemConstructorOptions[] = [
    {
      label: "PromptBr0",
      submenu: [
        aboutItem,
        checkUpdatesItem,
        openPaletteItem,
        { type: "separator" },
        settingsItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? ([{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] as MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    helpMenu,
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * The shared DB lives at resolveDatabasePath() (~/Library/Application
 * Support/PromptBr0/library.db on macOS). Databases written by early dev
 * builds that kept the file inside app.getPath("userData") are migrated by
 * COPY (the source is left untouched), only when the new DB doesn't exist.
 * WAL/SHM sidecars are copied along with the main file.
 */
function resolveAppDatabasePath(): string {
  const target = resolveDatabasePath();
  // In dev, userData follows the app name, so older dev builds may have left
  // the database inside it or in a sibling "Electron" directory.
  const legacyCandidates = [
    path.join(app.getPath("userData"), "library.db"),
    path.join(path.dirname(app.getPath("userData")), "Electron", "library.db"),
  ];
  const legacy = legacyCandidates.find((candidate) => candidate !== target && fs.existsSync(candidate));
  if (legacy && !fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(legacy + suffix)) fs.copyFileSync(legacy + suffix, target + suffix);
    }
    console.log(`[main] migrated legacy database from ${legacy} to ${target}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return target;
}

// Brand icon: packaged builds embed it via electron-builder, but in dev the
// binary is Electron.app — so set the dock/window icon at runtime too.
const appIconPath = path.join(app.getAppPath(), "build", "icon.png");
const appIcon = fs.existsSync(appIconPath)
  ? nativeImage.createFromPath(appIconPath)
  : undefined;

function quickPaletteRendererUrl(): string {
  const base = process.env["ELECTRON_RENDERER_URL"]
    ?? pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
  const url = new URL(base);
  url.hash = "quick-palette";
  return url.href;
}

function createQuickPaletteWindow(handlers: QuickPaletteWindowHandlers): QuickPaletteWindowPort {
  const expectedUrl = quickPaletteRendererUrl();
  const nativeWindow = new BrowserWindow(
    quickPaletteWindowOptions(
      path.join(__dirname, "../preload/index.js"),
      process.platform,
    ) as BrowserWindowConstructorOptions,
  );
  nativeWindow.setMenu(null);
  nativeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  nativeWindow.on("blur", handlers.blur);
  nativeWindow.on("closed", handlers.closed);
  nativeWindow.webContents.once("did-finish-load", handlers.ready);
  nativeWindow.webContents.on("did-fail-load", (_event, errorCode, description, _url, isMainFrame) => {
    if (isMainFrame) handlers.failed(new Error(`Prompt palette load failed (${errorCode}): ${description}`));
  });
  nativeWindow.webContents.on("render-process-gone", (_event, details) => {
    handlers.failed(new Error(`Prompt palette renderer exited: ${details.reason}`));
  });
  nativeWindow.webContents.on("will-navigate", (event, url) => {
    if (url === expectedUrl) return;
    event.preventDefault();
    handlers.failed(new Error("Prompt palette blocked unexpected navigation."));
  });
  void nativeWindow.loadURL(expectedUrl).catch(handlers.failed);

  return {
    sender: nativeWindow.webContents,
    mainFrame: () => nativeWindow.webContents.mainFrame,
    send: (channel, payload) => {
      if (!nativeWindow.isDestroyed() && !nativeWindow.webContents.isDestroyed()) {
        nativeWindow.webContents.send(channel, payload);
      }
    },
    show: () => nativeWindow.show(),
    focus: () => nativeWindow.focus(),
    hide: () => nativeWindow.hide(),
    destroy: () => nativeWindow.destroy(),
    isDestroyed: () => nativeWindow.isDestroyed(),
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    ...(appIcon && !appIcon.isEmpty() ? { icon: appIcon } : {}),
    // Best guess at the renderer's theme before localStorage is readable;
    // the pre-paint script in index.html applies the exact stored preference.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B0E14" : "#F7F7F5",
    title: "PromptBr0",
    // Off-macOS the default app menu carries macOS-centric roles; hide it
    // (still reachable via Alt) until a real cross-platform menu exists.
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  mainWindowPresented = false;
  window.on(
    "close",
    createMainWindowCloseHandler(window, {
      isTrayEnabled: () => trayController?.isEnabled() ?? false,
      isQuitting: () => isQuitting,
      onHideToTray: () => {
        // Known Electron limitation: dock.hide() within a second of the
        // previous call is ignored, so only touch a visible icon.
        if (process.platform === "darwin" && app.dock?.isVisible()) app.dock.hide();
      },
    }),
  );
  // Windows shutdown closes windows without going through app.quit(); let the
  // close through so a hidden-to-tray app cannot block a restart or log-off.
  window.on("session-end", () => {
    isQuitting = true;
  });
  window.on(
    "closed",
    createMainWindowClosedHandler(window, {
      getMainWindow: () => mainWindow,
      onMainWindowClosed: (senderId) => {
        markdownImportService?.discardSender(senderId);
        mainWindow = null;
      },
      onWindowClosed: () => importDispatcher.windowClosed(),
      shouldQuit: () =>
        shouldQuitWhenMainWindowCloses(process.platform) && !(trayController?.isEnabled() ?? false),
      quit: () => app.quit(),
    }),
  );
  // Renderer content never opens new windows; external links go through the
  // app:open-external IPC (system browser) instead.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Only the dev-server origin (dev) or the packaged index.html (prod) may
  // load in this window; everything else is blocked.
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  const allowedFileUrl = pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
  window.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    try {
      allowed = devServerUrl ? new URL(url).origin === new URL(devServerUrl).origin : url === allowedFileUrl;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      console.warn(`[main] blocked navigation to ${url.slice(0, 200)}`);
      event.preventDefault();
    }
  });

  window.on("ready-to-show", () => {
    mainWindowPresented = true;
    window.show();
  });

  // Marks the renderer able to receive IPC and flushes any queued import.
  window.webContents.once("did-finish-load", () => importDispatcher.rendererReady());

  // Dev: forward renderer console output to the terminal.
  if (process.env["ELECTRON_RENDERER_URL"]) {
    window.webContents.on("console-message", (event) => {
      const { level, message } = event as unknown as { level: number; message: string };
      logRendererConsoleMessage(console, level, message);
    });
  }

  // Dev/QA hook: PROMPTBR0_SCREENSHOT=/path/to.png captures the window
  // after load (used when the host lacks Screen Recording permission).
  // PROMPTBR0_CLICK=css-selector clicks an element first (e.g. open a
  // popover before the capture).
  const screenshotPath = process.env["PROMPTBR0_SCREENSHOT"];
  if (screenshotPath) {
    const clickSelector = process.env["PROMPTBR0_CLICK"];
    window.webContents.once("did-finish-load", () => {
      if (clickSelector) {
        // Multiple selectors (split on ";;") are clicked in order, 400ms
        // apart — e.g. open the settings popover, then its "About" row.
        clickSelector.split(";;").forEach((selector, index) => {
          setTimeout(() => {
            void window.webContents.executeJavaScript(
              `document.querySelector(${JSON.stringify(selector)})?.click()`,
            );
          }, index * 400);
        });
      }
      for (const [delay, suffix] of [[4000, ""], [9000, "-late"]] as const) {
        setTimeout(() => {
          void window.webContents.capturePage().then((image) => {
            fs.writeFileSync(screenshotPath.replace(".png", `${suffix}.png`), image.toPNG());
            console.log(`[main] screenshot written (delay ${delay}ms)`);
          });
          void window.webContents
            .executeJavaScript("document.querySelector('main, #root')?.innerText.slice(0, 400) ?? ''")
            .then((text) => console.log(`[main] dom @${delay}ms:`, JSON.stringify(text).slice(0, 500)));
        }, delay);
      }
    });
  }

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return window;
}

// Single instance: a second launch focuses the existing window and quits, so
// the CLI and one app instance are the only DB writers.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.error("[main] another instance is already running");
  dialog.showErrorBox(
    "PromptBr0 is already running",
    "Another instance of PromptBr0 is already running. Please close it before starting a new one.",
  );
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    const intent = deepLinkFromArgv(argv);
    if (intent) importDispatcher.dispatch(intent);
  });

  app.whenReady().then(() => {
  dbPath = resolveAppDatabasePath();
  backupsDir = path.join(path.dirname(dbPath), "backups");
  const opened = openDatabase(dbPath);
  db = opened.db;
  library = new PromptLibrary(db);
  console.log(`[main] database opened at ${dbPath}${opened.backupPath ? ` (pre-migration backup: ${opened.backupPath})` : ""}`);

  backupScheduler = createDailyBackupScheduler({
    latestBackupMtimeMs: () => latestBackup(backupsDir!)?.mtimeMs ?? null,
    createBackup: () => {
      writeBackup();
    },
    onError: (error) => console.error("[main] automatic backup failed:", error),
  });
  // Start synchronously to preserve the existing startup due-check, then keep
  // checking while the app remains open.
  backupScheduler.start();

  // Multi-device sync: pure P2P over the local network (see
  // docs-internal/specs/2026-08-27-sync-design.md). Ops are durable in
  // SQLite, so this only starts the listener when the feature is enabled.
  // Constructed before handler registration — the sync IPC block dereferences it.
  desktopSync = new DesktopSync({
    lib: library,
    db,
    identityDir: path.join(app.getPath("userData"), "sync"),
    deviceNameFallback: () => os.hostname(),
    sendStatus: (status) => mainWindow?.webContents.send(IPC_CHANNELS.syncStateChanged, status),
    sendPairRequest: (event) => mainWindow?.webContents.send(IPC_CHANNELS.syncPairRequest, event),
    sendPairRequestClosed: (event) =>
      mainWindow?.webContents.send(IPC_CHANNELS.syncPairRequestClosed, event),
    log: (message) => console.log(`[sync] ${message}`),
  });
  updateService = new UpdateService({
    currentVersion: __APP_VERSION__,
    platform: process.platform,
    architecture: process.arch,
    runningUnderArm64Translation: app.runningUnderARM64Translation,
    launchedFromAppImage: Boolean(process.env["APPIMAGE"]),
    isDevelopment: Boolean(process.env["ELECTRON_RENDERER_URL"]),
    getSetting: (key) => library?.getSetting(key) ?? null,
    setSetting: (key, value) => getLibrary().setSetting(key, value),
    fetchImpl: (input, init) => fetch(input, init),
    openExternal: (url) => shell.openExternal(url),
    now: () => new Date(),
    emitState: (state) =>
      mainWindow?.webContents.send(
        IPC_CHANNELS.updateStateChanged,
        updateStateDtoSchema.parse(state),
      ),
  });

  quickPaletteController = createQuickPaletteController({
    library,
    readSetting: () => library?.getSetting(QUICK_PALETTE_SETTINGS_KEY) ?? null,
    writeSetting: (value) => getLibrary().setSetting(QUICK_PALETTE_SETTINGS_KEY, value),
    shortcut: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    createWindow: createQuickPaletteWindow,
    getMainFrame: () =>
      mainWindow && !mainWindow.isDestroyed()
        ? { sender: mainWindow.webContents, frame: mainWindow.webContents.mainFrame }
        : null,
    clipboardWriteText: (content) => clipboard.writeText(content),
    uuid: randomUUID,
    reportError: (error) => console.error("[main] quick palette error:", error),
  });
  registerQuickPaletteIpcHandlers(
    {
      handle: (channel, handler) => {
        ipcMain.handle(channel, (event, payload) => handler(event, payload));
      },
    },
    quickPaletteController,
  );

  // System tray: device-local preference stored in the settings table. Built
  // before IPC registration so the handlers can rely on it, and before the
  // window exists so a saved opt-in survives the very first close.
  trayController = createTrayController({
    readSetting: (key) => library?.getSetting(key) ?? null,
    writeSetting: (key, value) => getLibrary().setSetting(key, value),
    createTray: (): TrayPort | null => {
      const icon = loadTrayIcon(process.platform);
      if (!icon) {
        console.log("[main] tray icon not found (run `pnpm --filter @promptbr0/desktop icons`)");
        return null;
      }
      return new Tray(icon);
    },
    buildContextMenu: (items) =>
      Menu.buildFromTemplate(
        items.map((item) => ({ label: item.label, click: item.click })),
      ),
    showMainWindow,
    quitApp: () => app.quit(),
    reportError: (error) => console.error("[main] tray error:", error),
  });

  registerIpcHandlers();
  console.log(`[main] IPC handlers registered: ${Object.values(IPC_CHANNELS).length} channels`);

  void desktopSync.ensureStarted();
  // Background drain: refines writes from this app but also from the CLI,
  // which shares the database file.
  syncPokeTimer = setInterval(() => desktopSync?.poke(), 60_000);
  syncPokeTimer.unref?.();

  updateStartupTimer = scheduleAutomaticUpdateCheck(() => {
    void updateService?.checkAutomaticallyAtStartup();
  });

  installAppMenu();
  // Dev mode runs the bare Electron binary, whose dock icon is the Electron
  // atom — point the dock at the brand icon instead.
  if (process.platform === "darwin" && appIcon && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }
  // Windows/Linux cold start: the deep link arrives in this instance's argv.
  const coldStartIntent = deepLinkFromArgv(process.argv);
  if (!mainWindow) createWindow();
  if (coldStartIntent) importDispatcher.dispatch(coldStartIntent);

  app.on("activate", () => {
    showMainWindow();
  });
  });
}

app.on("window-all-closed", () => {
  // With close-to-tray enabled the window usually only hides (so this event
  // does not fire); if it was destroyed anyway, the tray keeps the app alive
  // and Show recreates it.
  if (trayController?.isEnabled()) return;
  if (process.platform !== "darwin") app.quit();
});

const handleBeforeQuit = createBeforeQuitHandler({
  clearBackgroundWork: () => {
    trayController?.dispose();
    trayController = null;
    quickPaletteController?.dispose();
    quickPaletteController = null;
    backupScheduler?.stop();
    backupScheduler = null;
    if (syncPokeTimer) clearInterval(syncPokeTimer);
    syncPokeTimer = null;
    if (updateStartupTimer) clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  },
  stopSync: () => desktopSync?.stop() ?? Promise.resolve(),
  quit: () => app.quit(),
  log: (message, error) => console.error(`[main] ${message}:`, error),
});

const handleWillQuit = createWillQuitHandler({
  disposeSync: () => desktopSync?.dispose(),
  closeDatabase: () => {
    db?.close();
    db = null;
    library = null;
  },
  log: (message, error) => console.error(`[main] ${message}:`, error),
});

app.on("before-quit", (event) => {
  // A real quit must close the window instead of hiding it into the tray.
  isQuitting = true;
  // Prevent Electron from terminating while a queued sync restart still owns
  // sockets or SQLite. The helper reissues quit after stop completes; the
  // will-quit boundary closes SQLite after renderer windows are gone.
  void handleBeforeQuit(event);
});

app.on("will-quit", handleWillQuit);

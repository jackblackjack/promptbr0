import fs from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { LATEST_SCHEMA_VERSION, pendingMigrationCount, runMigrations } from "./migrations.js";

function applyPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Overwrite freed content so hard-deleted prompts/notes don't linger in
  // the file for anyone with read access to it.
  db.pragma("secure_delete = ON");
  // The CLI can write while the desktop app holds the DB open;
  // wait briefly for locks instead of failing immediately.
  db.pragma("busy_timeout = 3000");
}

/**
 * Restricts a database file (or sidecar/backup) to its owner. Windows has no
 * POSIX mode bits (only a read-only flag), so tightening is skipped there;
 * exotic filesystems may reject chmod — the database stays usable regardless.
 */
export function restrictPermissions(path: string): void {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(path, 0o600);
  } catch {
    // Permissions are defense-in-depth; failure must not block opening.
  }
}

/**
 * Backs up a database file (main file plus any WAL/SHM sidecars) before
 * running migrations against an existing on-disk database. The snapshots are
 * full plaintext copies of the library, so only the newest few survive.
 */
function backupDatabaseFile(db: Database.Database, path: string): string {
  // Flush WAL content into the main file so the plain file copy is complete.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.backup-${stamp}`;
  fs.copyFileSync(path, backupPath);
  restrictPermissions(backupPath);
  // Stamps sort lexicographically (= chronologically), so dropping everything
  // but the last three keeps the three newest snapshots.
  const stale = fs
    .readdirSync(dirname(path))
    .filter((name) => name.startsWith(`${basename(path)}.backup-`))
    .sort()
    .slice(0, -3);
  for (const name of stale) fs.rmSync(join(dirname(path), name), { force: true });
  return backupPath;
}

export interface OpenDatabaseResult {
  db: Database.Database;
  /** Path of the pre-migration backup, if one was made. */
  backupPath: string | null;
}

/**
 * Opens (creating if necessary) a database at `path`, applies pragmas, backs
 * up an existing file if migrations are pending, then runs migrations.
 */
export function openDatabase(path: string): OpenDatabaseResult {
  const existed = fs.existsSync(path);
  // The mode only lands on directories created here (the dedicated PromptBr0
  // config directory); a pre-existing directory — e.g. PROMPTBR0_DB pointed
  // at a shared location — keeps its permissions untouched.
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  applyPragmas(db);
  restrictPermissions(path);
  // WAL/SHM sidecars hold the same plaintext data while they exist.
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${path}${suffix}`;
    if (fs.existsSync(sidecar)) restrictPermissions(sidecar);
  }

  let backupPath: string | null = null;
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (existed && currentVersion < LATEST_SCHEMA_VERSION && pendingMigrationCount(db) > 0) {
    backupPath = backupDatabaseFile(db, path);
  }

  runMigrations(db);
  return { db, backupPath };
}

/** Opens an in-memory database with migrations applied. No backups. */
export function openMemoryDatabase(): Database.Database {
  const db = new Database(":memory:");
  applyPragmas(db);
  runMigrations(db);
  return db;
}

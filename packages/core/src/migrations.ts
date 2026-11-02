import type BetterSqlite3 from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";
import { repairNaturalKeyMerges } from "./sync/natural-key-repair.js";
import { syncMigrationSql, syncV9Sql, syncV10Sql, syncV11Sql } from "./sync/tables.js";

/** v17 SQL is empty — column addition and table recreation happen in repair. */
function syncV17Sql(): string {
  return "";
}

interface Migration {
  version: number;
  name: string;
  sql: string;
  repair?: (db: BetterSqlite3.Database) => void;
}

/**
 * Forward-only, numbered migrations. Applied in order; the highest applied
 * version is tracked in SQLite's `user_version` pragma.
 */
const migrations: Migration[] = [
  { version: 1, name: "initial-schema", sql: SCHEMA_SQL },
  // Version lifecycle + provenance for agent-suggested variations. Existing
  // rows become active/user, preserving pre-migration behavior exactly.
  {
    version: 2,
    name: "version-status-source",
    sql: `
ALTER TABLE versions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE versions ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
`,
  },
  // AI run bookkeeping + provider configuration. Existing runs were all
  // manual completions, so they backfill to status 'completed'.
  {
    version: 3,
    name: "ai-providers-and-run-results",
    sql: `
ALTER TABLE runs ADD COLUMN provider TEXT;
ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE runs ADD COLUMN output TEXT;
ALTER TABLE runs ADD COLUMN error TEXT;
ALTER TABLE runs ADD COLUMN latency_ms INTEGER;
ALTER TABLE runs ADD COLUMN run_group_id TEXT;

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_enc TEXT,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE provider_models (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (provider_id, model_id)
);
`,
  },
  // Driver model: `type` becomes the models.dev catalog id (e.g. 'groq'),
  // `driver` decides execution ('openai'|'anthropic'|'google'|
  // 'openai-compatible'). Pre-existing rows all had one of the four original
  // types, which are exactly the driver ids — so driver backfills from type.
  {
    version: 4,
    name: "provider-driver",
    sql: `
ALTER TABLE providers ADD COLUMN driver TEXT NOT NULL DEFAULT 'openai-compatible';
UPDATE providers SET driver = type;
`,
  },
  // Local bookkeeping for published portal snapshots. The delete token is
  // stored plaintext ON PURPOSE: it exists only here (the portal keeps a
  // sha256 hash) and is needed verbatim to revoke the share later. prompt_id
  // is nullable with ON DELETE SET NULL: the share record and its revoke
  // token must survive a hard delete of the prompt (the "(deleted prompt)"
  // DTO fallback in the desktop app anticipates this).
  {
    version: 5,
    name: "shared-snapshots",
    sql: `
CREATE TABLE shared_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  portal_base_url TEXT NOT NULL,
  url TEXT NOT NULL,
  delete_token TEXT NOT NULL,
  full_history INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_shared_snapshots_prompt ON shared_snapshots(prompt_id);
`,
  },
  // Multi-device sync storage. Triggers capture every write (from the app,
  // CLI (and other writers) — they share this file) into sync_dirty; pure SQL on
  // purpose so older binaries keep working. The sync engine turns dirty rows
  // into ops in sync_ops and exchanges them peer-to-peer. See
  // docs-internal/specs/2026-08-27-sync-design.md.
  {
    version: 6,
    name: "sync-tables-and-triggers",
    sql: syncMigrationSql(),
  },
  // v7: shared_snapshots sync — no-op (table dropped in v18).
  // Previously called syncV7Sql(); kept as empty migration to preserve version numbering.
  {
    version: 7,
    name: "shared-snapshots-sync-noop",
    sql: "",
  },
  // The version row is only a lineage anchor: users can execute an edited
  // draft with variable values that differ from its saved content.
  // Existing runs stay nullable so their historical behavior can fall back
  // to version content when the exact execution input was never recorded.
  {
    version: 8,
    name: "run-prompt-content",
    sql: `
ALTER TABLE runs ADD COLUMN prompt_content TEXT;
`,
  },
  {
    version: 9,
    name: "delimiter-safe-sync-record-keys",
    sql: syncV9Sql(),
  },
  {
    version: 10,
    name: "durable-prompt-hard-delete-tombstones",
    sql: syncV10Sql(),
  },
  {
    version: 11,
    name: "canonical-natural-key-sync",
    sql: syncV11Sql(),
    repair: repairNaturalKeyMerges,
  },
  // JSON library imports used to accept every settings row. Preserve the
  // catalog for offline model use, but remove any pre-upgrade claim that it
  // may choose an environment variable and connection-test destination.
  {
    version: 12,
    name: "revoke-model-catalog-credential-trust",
    sql: "DELETE FROM settings WHERE key = 'model_catalog_credential_trusted';",
  },
  {
    version: 13,
    name: "version-bound-prompt-drafts",
    sql: "",
    repair: (db) => {
      const columns = db.pragma("table_info(prompts)") as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "draft_base_version_id")) {
        db.exec("ALTER TABLE prompts ADD COLUMN draft_base_version_id TEXT");
      }
    },
  },
  {
    version: 14,
    name: "sync-merge-history-lookup-indexes",
    sql: `
CREATE INDEX idx_sync_ops_natural_name_lookup
ON sync_ops (
  table_name,
  json_extract(payload_json, '$.name'),
  json_extract(payload_json, '$.prompt_id')
)
WHERE payload_json IS NOT NULL;

CREATE INDEX idx_versions_prompt ON versions(prompt_id, id);
CREATE INDEX idx_ratings_target ON ratings(target_type, target_id);
`,
  },
  {
    version: 15,
    name: "incremental-search-row-mapping",
    sql: `
CREATE TABLE search_index_rows (
  rowid INTEGER PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version_id TEXT
);

CREATE INDEX idx_search_index_rows_prompt
ON search_index_rows(prompt_id);

CREATE UNIQUE INDEX idx_search_index_rows_prompt_metadata
ON search_index_rows(prompt_id)
WHERE version_id IS NULL;

CREATE UNIQUE INDEX idx_search_index_rows_version
ON search_index_rows(version_id)
WHERE version_id IS NOT NULL;

INSERT INTO search_index_rows (rowid, prompt_id, version_id)
SELECT rowid, prompt_id, version_id FROM search_index;
`,
  },
  // A pre-v16 binary could advance user_version past v13 without running its
  // repair callback, leaving the draft-base column absent. Keep this forward
  // repair idempotent so those databases become usable without manual edits.
  {
    version: 16,
    name: "repair-version-bound-prompt-drafts",
    sql: "",
    repair: (db) => {
      const columns = db.pragma("table_info(prompts)") as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "draft_base_version_id")) {
        db.exec("ALTER TABLE prompts ADD COLUMN draft_base_version_id TEXT");
      }
    },
  },
  // Collections become a folder hierarchy. Existing name-only natural-key
  // remaps become stale because the merge key changes from name to (parent,
  // name). This repair flattens all collection remaps so every collection
  // becomes a top-level folder, then clears the remap table.
  {
    version: 17,
    name: "collections-folder-hierarchy",
    sql: syncV17Sql(),
    repair: (db) => {
      // For upgrade path (v16 and below): add parent_collection_id column if
      // missing, then recreate the table with path-aware UNIQUE(name, parent_id).
      // For fresh v17 databases the column already exists — this is a no-op.
      // FK is disabled by the migration runner (runMigrationsThrough) before
      // entering the transaction, because PRAGMA foreign_keys cannot be changed
      // inside a transaction in better-sqlite3.
      const columns = db.pragma("table_info(collections)") as Array<{ name: string }>;
      if (!columns.some((c) => c.name === "parent_collection_id")) {
        // Rename old table to backup before dropping — this preserves
        // the data so we can re-insert into the new table afterwards.
        db.exec("ALTER TABLE collections RENAME TO collections_old");

        // Create new table with path-aware unique constraint and FK.
        db.exec(`
          CREATE TABLE collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            parent_collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
            UNIQUE(name, parent_collection_id)
          );
        `);

        // Copy collections data from old table (parent_collection_id stays NULL).
        db.exec(
          "INSERT INTO collections (id, name, sort_order) SELECT id, name, sort_order FROM collections_old",
        );

        // Clean up backup table.
        db.exec("DROP TABLE collections_old");
      }
      // Index for recursive descendant lookups — safe to create even if it exists.
      db.exec("CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_collection_id)");

      // Discard every existing name-only remap for collections: the old key
      // (name) no longer determines merge identity — (parent, name) does.
      // No reassignment needed: old remaps are simply discarded since each
      // collection now has a unique (parent, name) key and will not merge
      // across parents.
      db.exec("DELETE FROM sync_id_remaps WHERE table_name = 'collections'");
    },
  },
  // Sharing was retired. Drop the local shared_snapshots table; any sync
  // metadata it generated is inert now that the table no longer exists.
  {
    version: 18,
    name: "drop-shared-snapshots",
    sql: "DROP TABLE IF EXISTS shared_snapshots;",
  },
  // Optional prompt blocks ride the prompts row as one JSON column. The CHECK
  // keeps every write path honest — app writes, sync apply from peers, import
  // and manual edits cannot store syntactically invalid JSON. The envelope
  // shape is validated at the boundaries (blocks.ts), not here.
  {
    version: 19,
    name: "prompt-blocks-json",
    sql: "ALTER TABLE prompts ADD COLUMN blocks_json TEXT CHECK (blocks_json IS NULL OR json_valid(blocks_json));",
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

/** Returns the number of pending migrations for an open database. */
export function pendingMigrationCount(db: BetterSqlite3.Database): number {
  const current = db.pragma("user_version", { simple: true }) as number;
  return migrations.filter((m) => m.version > current).length;
}

export function runMigrations(db: BetterSqlite3.Database): void {
  runMigrationsThrough(db, LATEST_SCHEMA_VERSION);
}

/** Direct-module fixture helper; deliberately absent from the public package API. */
export function runMigrationsThrough(db: BetterSqlite3.Database, throughVersion: number): void {
  if (!Number.isInteger(throughVersion) || throughVersion < 0 || throughVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(`Unknown migration version: ${throughVersion}`);
  }
  const current = db.pragma("user_version", { simple: true }) as number;

  // Some migrations (v17) need to re-create tables with self-referential FKs
  // while also renaming the old table — this requires foreign_keys = OFF.
  // PRAGMA foreign_keys cannot be changed inside a transaction, so we disable
  // it before any transaction starts. SQLite validates constraints at schema
  // change time regardless of the pragma, so this is safe.
  const hasRepair = migrations.some(
    (m) => m.version > current && m.version <= throughVersion && m.repair,
  );
  if (hasRepair) db.exec("PRAGMA foreign_keys = OFF");

  try {
    for (const migration of migrations) {
      if (migration.version <= current || migration.version > throughVersion) continue;
      db.transaction(() => {
        db.exec(migration.sql);
        migration.repair?.(db);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  } finally {
    if (hasRepair) db.exec("PRAGMA foreign_keys = ON");
  }
}

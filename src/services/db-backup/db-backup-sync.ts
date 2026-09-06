import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getBackupsDir, backupFileName, type BackupReason } from "./db-backup-paths.ts";
import { selectBackupsToDelete, DEFAULT_RETENTION, type RetentionPolicy } from "./db-backup-retention.ts";

/**
 * Synchronous core of the snapshot mechanism.
 *
 * Split from `db-backup.service.ts` for one structural reason: `db.service`
 * takes a snapshot before running migrations, from inside the synchronous
 * `getDb()` path, so that call cannot await. Keeping this core free of any
 * import of `db.service` also means the caller passes the database path in,
 * which removes what would otherwise be an import cycle.
 *
 * VACUUM INTO is SQLite's own online-backup statement: a transactionally
 * consistent, compacted copy taken while the server keeps reading and writing.
 * A plain file copy is NOT equivalent — it can catch the main database and its
 * write-ahead log out of step and produce exactly the unopenable file this
 * mechanism exists to recover from.
 */

export interface BackupResult {
  path: string;
  bytes: number;
  ms: number;
  pruned: string[];
}

export interface BackupOptions {
  /** Reuse an already-open connection — required when snapshotting state that same handle is about to migrate. */
  sourceDb?: Database;
  /** Source database file. */
  dbPath: string;
  retention?: RetentionPolicy;
  now?: Date;
}

function ensureBackupsDir(dir: string): void {
  // Only mkdir when actually missing: recursive mkdir throws EEXIST against
  // some Windows folders carrying the ReadOnly attribute.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Open a snapshot and run a full integrity_check.
 *
 * Called right after writing a snapshot and again before restoring one. An
 * unverified backup is not a backup: during the incident that motivated this
 * module, two copies that looked present (a VSS shadow, a WAL rebuild) both
 * turned out to be unusable only at the moment they were needed.
 */
export function verifyBackupFile(path: string): { ok: boolean; detail: string } {
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    const row = db.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
    const detail = row?.integrity_check ?? "no result";
    return { ok: detail === "ok", detail };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/** Write one verified snapshot, then apply retention. Throws if the snapshot cannot be verified. */
export function backupDbSync(reason: BackupReason, opts: BackupOptions): BackupResult {
  const { dbPath } = opts;
  if (!existsSync(dbPath)) throw new Error(`No database to back up at ${dbPath}`);

  const dir = getBackupsDir();
  ensureBackupsDir(dir);

  const dbFile = basename(dbPath);
  const finalPath = resolve(dir, backupFileName(dbFile, opts.now ?? new Date(), reason));
  // Snapshot under a .partial name so an interrupted run leaves nothing
  // parseBackupName would ever offer as a restore candidate.
  const partialPath = `${finalPath}.partial`;
  rmSync(partialPath, { force: true });

  const started = Date.now();
  // Read-write (not readonly) on purpose: a readonly connection cannot recover
  // a hot write-ahead log when it is the only connection, which is exactly the
  // case for a manual backup while the server is stopped. VACUUM INTO never
  // modifies the source either way.
  const source = opts.sourceDb ?? new Database(dbPath);
  try {
    // The path is ours, but a home directory can legitimately contain an apostrophe.
    source.exec(`VACUUM INTO '${partialPath.replace(/'/g, "''")}'`);
  } finally {
    if (!opts.sourceDb) source.close();
  }

  const check = verifyBackupFile(partialPath);
  if (!check.ok) {
    rmSync(partialPath, { force: true });
    throw new Error(`Snapshot failed integrity_check (${check.detail}) — discarded, no backup written`);
  }

  renameSync(partialPath, finalPath);
  const ms = Date.now() - started;

  const pruned: string[] = [];
  const stem = dbFile.replace(/\.db$/, "");
  for (const name of selectBackupsToDelete(readdirSync(dir), stem, opts.retention ?? DEFAULT_RETENTION)) {
    // A locked or vanished snapshot is a pruning hiccup, not a backup failure —
    // the new snapshot is already written and verified by this point.
    try { rmSync(resolve(dir, name), { force: true }); pruned.push(name); } catch { /* keep going */ }
  }

  return { path: finalPath, bytes: statSync(finalPath).size, ms, pruned };
}

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { getBackupsDir, parseBackupName, type BackupReason } from "./db-backup-paths.ts";
import { backupDbSync, type BackupOptions, type BackupResult } from "./db-backup-sync.ts";

/**
 * Async-friendly facade over the synchronous snapshot core, for callers that
 * do not already hold the database open: the supervisor's hourly tick, the
 * start-up snapshot, and the `ppm backup` command. It resolves the active
 * database path lazily, so importing this module never opens a database.
 */

export type { BackupResult, BackupOptions };
export { verifyBackupFile } from "./db-backup-sync.ts";

export interface BackupEntry {
  name: string;
  path: string;
  bytes: number;
  date: Date;
  reason: BackupReason;
}

/** Snapshot files present for a database stem (`ppm`, `ppm.dev`), newest-first. */
export function listBackups(dbStem?: string): BackupEntry[] {
  const dir = getBackupsDir();
  if (!existsSync(dir)) return [];
  const out: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    const parsed = parseBackupName(name);
    if (!parsed) continue;
    if (dbStem && parsed.dbStem !== dbStem) continue;
    const path = resolve(dir, name);
    let bytes = 0;
    // A file that vanished between readdir and stat is simply not a candidate.
    try { bytes = statSync(path).size; } catch { continue; }
    out.push({ name, path, bytes, date: parsed.date, reason: parsed.reason });
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Basename-derived stem of the active database, e.g. `ppm` or `ppm.dev`. */
export async function activeDbStem(): Promise<string> {
  const { getDbPath } = await import("../db.service.ts");
  return basename(getDbPath()).replace(/\.db$/, "");
}

/** Age of the newest snapshot for the active database in ms, or null when there is none. */
export async function newestBackupAgeMs(now: Date = new Date()): Promise<number | null> {
  const newest = listBackups(await activeDbStem())[0];
  return newest ? now.getTime() - newest.date.getTime() : null;
}

/** Take one verified snapshot of the active database. */
export async function backupDb(
  reason: BackupReason,
  opts: Partial<Omit<BackupOptions, "dbPath">> & { dbPath?: string } = {},
): Promise<BackupResult> {
  const { getDbPath } = await import("../db.service.ts");
  return backupDbSync(reason, { ...opts, dbPath: opts.dbPath ?? getDbPath() });
}

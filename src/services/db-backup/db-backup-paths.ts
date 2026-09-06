import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import { getPpmDir, isIsolatedPpmHome } from "../ppm-dir.ts";

/**
 * Where database snapshots live, and how their filenames encode when and why
 * they were taken.
 *
 * The directory deliberately sits OUTSIDE `~/.ppm` in production. A snapshot
 * kept next to the database it protects dies with it: the whole point is to
 * survive the case where something wipes or overwrites the PPM directory.
 * Under an isolated `PPM_HOME` (tests) it goes back inside that temp dir, so a
 * test run can never write snapshots into the user's real home.
 *
 * `homedir()` here is a deliberate exception to the getPpmDir()-only rule (see
 * CLAUDE.md "PPM Directory"): the sibling location is the entire reason this
 * directory survives a PPM-directory wipe, so it cannot be derived from
 * `getPpmDir()` in production.
 */
export function getBackupsDir(): string {
  return isIsolatedPpmHome()
    ? resolve(getPpmDir(), "backups")
    : resolve(homedir(), ".ppm-backups");
}

/** Why a snapshot was taken. Encoded in the filename so `ppm restore` can explain each candidate. */
export type BackupReason = "hourly" | "premigrate" | "start" | "manual";

export const BACKUP_REASONS: readonly BackupReason[] = ["hourly", "premigrate", "start", "manual"];

/** `2026-09-06T15:46:00.000Z` → `20260906T154600Z` (filename-safe, still sorts chronologically). */
export function formatBackupStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Snapshot filename. `dbFile` is the SOURCE database's basename (`ppm.db`,
 * `ppm.dev.db`), kept in the name so a dev-profile run never prunes or
 * restores production snapshots.
 */
export function backupFileName(dbFile: string, date: Date, reason: BackupReason): string {
  const stem = basename(dbFile).replace(/\.db$/, "");
  return `${stem}-${formatBackupStamp(date)}-${reason}.db`;
}

export interface ParsedBackupName {
  dbStem: string;
  date: Date;
  reason: BackupReason;
}

/**
 * Inverse of `backupFileName`. Returns null for anything this module did not
 * write — including `.partial` files from an interrupted snapshot, which must
 * never be offered as a restore candidate.
 */
export function parseBackupName(name: string): ParsedBackupName | null {
  const m = /^(.+)-(\d{8}T\d{6}Z)-([a-z]+)\.db$/.exec(name);
  if (!m) return null;
  const [, dbStem, stamp, reason] = m;
  if (!BACKUP_REASONS.includes(reason as BackupReason)) return null;
  const iso = `${stamp!.slice(0, 4)}-${stamp!.slice(4, 6)}-${stamp!.slice(6, 8)}T${stamp!.slice(9, 11)}:${stamp!.slice(11, 13)}:${stamp!.slice(13, 15)}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { dbStem: dbStem!, date, reason: reason as BackupReason };
}

import { parseBackupName, type ParsedBackupName } from "./db-backup-paths.ts";

/**
 * Grandfather-father-son retention. Three tiers, unioned:
 *
 * - `recent`: the N newest snapshots regardless of age — the "what did I break
 *   in the last few hours" tier.
 * - `daily`: newest snapshot of each of the last N distinct calendar days (UTC).
 * - `weekly`: newest snapshot of each of the last N distinct ISO weeks.
 *
 * The daily/weekly depth is what catches slow, silent damage — the failure
 * mode that actually happened here: a database corrupted at 23:08 and not
 * noticed until the next morning's restart. A recent-only window would have
 * already rotated the last good copy away.
 */
export interface RetentionPolicy {
  recent: number;
  daily: number;
  weekly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { recent: 6, daily: 7, weekly: 4 };

/** UTC calendar day key, e.g. `2026-09-06`. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * ISO-week key, e.g. `2026-W37`. Uses the ISO rule (week belongs to the year
 * containing its Thursday) so the last days of December group correctly
 * instead of splitting a week across two year buckets.
 */
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // shift to that week's Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Newest-first, keeping only names this module wrote for the given database stem. */
function parseAndSort(names: string[], dbStem: string): Array<ParsedBackupName & { name: string }> {
  return names
    .map((name) => {
      const parsed = parseBackupName(name);
      return parsed && parsed.dbStem === dbStem ? { ...parsed, name } : null;
    })
    .filter((x): x is ParsedBackupName & { name: string } => x !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** The snapshots the policy keeps, newest-first. */
export function selectBackupsToKeep(
  names: string[],
  dbStem: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): string[] {
  const sorted = parseAndSort(names, dbStem);
  const keep = new Set<string>();

  for (const entry of sorted.slice(0, policy.recent)) keep.add(entry.name);

  // Snapshots are newest-first, so the first one seen for a bucket is that
  // bucket's newest — take it and skip the rest of the bucket.
  const takeNewestPerBucket = (key: (d: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const entry of sorted) {
      if (seen.size >= limit && !seen.has(key(entry.date))) continue;
      if (seen.has(key(entry.date))) continue;
      seen.add(key(entry.date));
      keep.add(entry.name);
    }
  };
  takeNewestPerBucket(dayKey, policy.daily);
  takeNewestPerBucket(weekKey, policy.weekly);

  return sorted.filter((e) => keep.has(e.name)).map((e) => e.name);
}

/**
 * The snapshots the policy discards. Anything unparseable is left strictly
 * alone: this function only ever proposes deleting files it can prove it
 * wrote itself.
 */
export function selectBackupsToDelete(
  names: string[],
  dbStem: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): string[] {
  const keep = new Set(selectBackupsToKeep(names, dbStem, policy));
  return parseAndSort(names, dbStem)
    .filter((e) => !keep.has(e.name))
    .map((e) => e.name);
}

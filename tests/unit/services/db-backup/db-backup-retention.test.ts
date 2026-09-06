import { describe, test, expect } from "bun:test";
import { backupFileName } from "../../../../src/services/db-backup/db-backup-paths.ts";
import {
  selectBackupsToKeep,
  selectBackupsToDelete,
  DEFAULT_RETENTION,
} from "../../../../src/services/db-backup/db-backup-retention.ts";

const hour = 3_600_000;
const base = Date.UTC(2026, 6, 1, 0, 0, 0); // 2026-07-01T00:00:00Z, a Wednesday

/** `count` hourly snapshots ending at `base + count*1h`. */
function hourlySeries(count: number, stem = "ppm.db"): string[] {
  return Array.from({ length: count }, (_, i) => backupFileName(stem, new Date(base + i * hour), "hourly"));
}

describe("selectBackupsToKeep", () => {
  test("keeps every snapshot while under the recent budget", () => {
    const names = hourlySeries(4);
    expect(selectBackupsToKeep(names, "ppm")).toHaveLength(4);
    expect(selectBackupsToDelete(names, "ppm")).toEqual([]);
  });

  test("collapses two months of hourly snapshots into the three tiers", () => {
    const names = hourlySeries(60 * 24);
    const keep = selectBackupsToKeep(names, "ppm");
    const del = selectBackupsToDelete(names, "ppm");

    // Union of the tiers, so at most recent+daily+weekly and never more.
    expect(keep.length).toBeLessThanOrEqual(
      DEFAULT_RETENTION.recent + DEFAULT_RETENTION.daily + DEFAULT_RETENTION.weekly,
    );
    // Every input is accounted for exactly once — nothing is silently ignored.
    expect(keep.length + del.length).toBe(names.length);
    expect(new Set([...keep, ...del]).size).toBe(names.length);
  });

  test("returns snapshots newest-first", () => {
    const keep = selectBackupsToKeep(hourlySeries(100), "ppm");
    const stamps = keep.map((n) => n.match(/-(\d{8}T\d{6}Z)-/)![1]!);
    expect([...stamps]).toEqual([...stamps].sort().reverse());
  });

  test("keeps the newest snapshot of each retained day, not the oldest", () => {
    // Two days, three snapshots each; the recent budget alone cannot cover both days.
    const names = [
      backupFileName("ppm.db", new Date(Date.UTC(2026, 6, 1, 1)), "hourly"),
      backupFileName("ppm.db", new Date(Date.UTC(2026, 6, 1, 23)), "hourly"),
      backupFileName("ppm.db", new Date(Date.UTC(2026, 6, 2, 1)), "hourly"),
    ];
    const keep = selectBackupsToKeep(names, "ppm", { recent: 1, daily: 2, weekly: 0 });
    expect(keep).toContain(backupFileName("ppm.db", new Date(Date.UTC(2026, 6, 1, 23)), "hourly"));
    expect(keep).not.toContain(backupFileName("ppm.db", new Date(Date.UTC(2026, 6, 1, 1)), "hourly"));
  });
});

describe("selectBackupsToDelete safety", () => {
  test("never proposes deleting a file it did not write", () => {
    const foreign = [
      "ppm.db",
      "ppm.db-wal",
      "notes.txt",
      "ppm-20260906T154600Z-hourly.db.partial", // interrupted snapshot
      "ppm-20260906T154600Z-bogusreason.db",
    ];
    expect(selectBackupsToDelete(foreign, "ppm")).toEqual([]);
  });

  test("never touches another database profile's snapshots", () => {
    // A dev-profile run must not prune production snapshots, and vice versa.
    const prod = hourlySeries(50, "ppm.db");
    const dev = hourlySeries(50, "ppm.dev.db");
    const deleted = selectBackupsToDelete([...prod, ...dev], "ppm.dev");
    expect(deleted.every((n) => n.startsWith("ppm.dev-"))).toBe(true);
    expect(selectBackupsToDelete([...prod, ...dev], "ppm").every((n) => !n.startsWith("ppm.dev-"))).toBe(true);
  });
});

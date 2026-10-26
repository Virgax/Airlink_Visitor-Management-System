/**
 * Offline queue for the kiosk (IndexedDB via `idb`). Scans made without network are stored with a client
 * generated `scanId` and posted later; the server dedupes on `scanId`. The pure flushing logic
 * (`flushScans`) is unit-tested with an in-memory poster; the idb wrappers are thin.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PassCache } from "@/lib/offline/provisional";

export type QueuedScan = { scanId: string; payload: string; at: string; attempts: number };

export type EvacuationSnapshot = {
  generatedAt: string;
  siteName: string;
  total: number;
  groups: Array<{ area: string; visits: Array<{ id: string; visitorName: string; company: string | null; host: string | null; enteredAt: string; status: string }> }>;
};

interface KioskDb extends DBSchema {
  scans: { key: string; value: QueuedScan };
  kv: { key: string; value: unknown };
}

const DB_NAME = "visitas-kiosk";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<KioskDb>> | null = null;

function getDb(): Promise<IDBPDatabase<KioskDb>> {
  if (!dbPromise) {
    dbPromise = openDB<KioskDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("scans", { keyPath: "scanId" });
        db.createObjectStore("kv");
      },
    });
  }
  return dbPromise;
}

export async function enqueueScan(scan: Omit<QueuedScan, "attempts">): Promise<void> {
  const db = await getDb();
  await db.put("scans", { ...scan, attempts: 0 });
}

export async function listQueuedScans(): Promise<QueuedScan[]> {
  const db = await getDb();
  const all = await db.getAll("scans");
  return all.sort((a, b) => a.at.localeCompare(b.at));
}

export async function removeQueuedScan(scanId: string): Promise<void> {
  const db = await getDb();
  await db.delete("scans", scanId);
}

export async function countQueuedScans(): Promise<number> {
  const db = await getDb();
  return db.count("scans");
}

export async function savePassCache(cache: PassCache): Promise<void> {
  const db = await getDb();
  await db.put("kv", cache, "passCache");
}

export async function loadPassCache(): Promise<PassCache | null> {
  const db = await getDb();
  return ((await db.get("kv", "passCache")) as PassCache | undefined) ?? null;
}

export async function saveEvacuation(snapshot: EvacuationSnapshot): Promise<void> {
  const db = await getDb();
  await db.put("kv", snapshot, "evacuation");
}

export async function loadEvacuation(): Promise<EvacuationSnapshot | null> {
  const db = await getDb();
  return ((await db.get("kv", "evacuation")) as EvacuationSnapshot | undefined) ?? null;
}

export type PostOutcome = "sent" | "retry" | "drop";

export type FlushResult = { sent: string[]; kept: string[]; dropped: string[] };

/** Scans that failed this many times are dropped (the server will never accept them). */
export const MAX_ATTEMPTS = 20;

/**
 * Pure flushing logic: posts each queued scan in order. "sent" and "drop" remove the scan; "retry" keeps it
 * (and stops the run, since the network is probably still down). A thrown poster counts as "retry".
 */
export async function flushScans(
  scans: QueuedScan[],
  post: (scan: QueuedScan) => Promise<PostOutcome>,
  maxAttempts = MAX_ATTEMPTS,
): Promise<FlushResult> {
  const result: FlushResult = { sent: [], kept: [], dropped: [] };
  let stopped = false;
  for (const scan of scans) {
    if (stopped) {
      result.kept.push(scan.scanId);
      continue;
    }
    let outcome: PostOutcome;
    try {
      outcome = await post(scan);
    } catch {
      outcome = "retry";
    }
    if (outcome === "sent") result.sent.push(scan.scanId);
    else if (outcome === "drop" || scan.attempts + 1 >= maxAttempts) result.dropped.push(scan.scanId);
    else {
      result.kept.push(scan.scanId);
      stopped = true;
    }
  }
  return result;
}

/** Flushes the IndexedDB queue through `post`, updating attempts and removing finished scans. */
export async function flushQueue(post: (scan: QueuedScan) => Promise<PostOutcome>): Promise<FlushResult> {
  const scans = await listQueuedScans();
  const result = await flushScans(scans, post);
  const db = await getDb();
  for (const id of [...result.sent, ...result.dropped]) await db.delete("scans", id);
  for (const id of result.kept) {
    const scan = scans.find((s) => s.scanId === id);
    if (scan) await db.put("scans", { ...scan, attempts: scan.attempts + 1 });
  }
  return result;
}

/** Maps an HTTP status to a queue outcome: 2xx sent, 4xx (except 401/408/429) dropped, anything else retried. */
export function outcomeForStatus(status: number): PostOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 401 || status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "drop";
  return "retry";
}

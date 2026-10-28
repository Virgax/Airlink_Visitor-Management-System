/**
 * IndexedDB store for the wardens' evacuation list (`/app/evacuacion`): the last server snapshot and the roll-call
 * ticks of the current drill. Separate database from the kiosk queue so a phone never mixes with a kiosk.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { WardenSnapshot } from "@/lib/server/evacuation";

export type RollCallState = { active: boolean; counted: string[] };

interface WardenDb extends DBSchema {
  kv: { key: string; value: unknown };
}

const DB_NAME = "visitas-warden";
let dbPromise: Promise<IDBPDatabase<WardenDb>> | null = null;

function getDb(): Promise<IDBPDatabase<WardenDb>> {
  if (!dbPromise) {
    dbPromise = openDB<WardenDb>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("kv");
      },
    });
  }
  return dbPromise;
}

export async function saveWardenSnapshot(snapshot: WardenSnapshot): Promise<void> {
  const db = await getDb();
  await db.put("kv", snapshot, "snapshot");
}

export async function loadWardenSnapshot(): Promise<WardenSnapshot | null> {
  const db = await getDb();
  return ((await db.get("kv", "snapshot")) as WardenSnapshot | undefined) ?? null;
}

export async function saveRollCall(state: RollCallState): Promise<void> {
  const db = await getDb();
  await db.put("kv", state, "rollCall");
}

export async function loadRollCall(): Promise<RollCallState | null> {
  const db = await getDb();
  return ((await db.get("kv", "rollCall")) as RollCallState | undefined) ?? null;
}

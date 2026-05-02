import { openDB, IDBPDatabase } from 'idb';
import { LearningModule } from '../types';

const DB_NAME = 'edugen-ai-db';
const STORE_NAME = 'modules';
const VERSION = 1;

export async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export async function saveModule(module: LearningModule) {
  const db = await getDB();
  await db.put(STORE_NAME, module);
}

export async function getAllModules(): Promise<LearningModule[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

export async function getModule(id: string): Promise<LearningModule | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function deleteModule(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

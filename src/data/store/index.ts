import path from 'path';
import { JsonStore } from './json-store';

export type { GameStore } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

let storeInstance: JsonStore | null = null;

export function getStore(): JsonStore {
  if (!storeInstance) {
    storeInstance = new JsonStore(DATA_DIR);
  }
  return storeInstance;
}

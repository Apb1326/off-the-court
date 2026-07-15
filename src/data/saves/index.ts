import path from 'path';
import { SaveStore } from './save-store';

export { SaveStore, AUTOSAVE_ID, SaveValidationError } from './save-store';
export type { LoadResult, SaveListError } from './save-store';

const DATA_DIR = path.join(process.cwd(), 'data');

let saveStoreInstance: SaveStore | null = null;

export function getSaveStore(): SaveStore {
  if (!saveStoreInstance) {
    saveStoreInstance = new SaveStore(DATA_DIR);
  }
  return saveStoreInstance;
}

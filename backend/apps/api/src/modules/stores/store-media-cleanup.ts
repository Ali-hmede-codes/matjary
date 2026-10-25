import { Logger } from '@nestjs/common';
import type { StorageService } from '@app/storage';

const logger = new Logger('StoreMediaCleanup');

// Runs after the database commit. A storage failure must not resurrect deleted
// rows, and retrying individual keys is safer than failing the whole response.
export async function deleteStoreObjects(
  storage: StorageService,
  keys: Iterable<string>,
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.deleteObject(key);
    } catch {
      logger.warn('Could not remove a deleted store media object');
    }
  }
}

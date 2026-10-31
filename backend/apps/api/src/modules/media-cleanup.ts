import { Logger } from '@nestjs/common';
import type { MediaArchiveService, StorageService } from '@app/storage';

const logger = new Logger('MediaCleanup');

// Runs after the database commit. A storage failure must not resurrect deleted
// rows, and retrying individual keys is safer than failing the whole response.
export async function deleteStoredObjects(
  storage: StorageService,
  keys: Iterable<string>,
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.deleteObject(key);
    } catch {
      logger.warn('Could not remove a deleted media object');
    }
  }
}

// A permanently deleted shop may still hold bytes in the archive tier. The
// archive is optional because unit fixtures construct the services without it.
export async function deleteArchivedShop(
  archive: Pick<MediaArchiveService, 'deleteStore'> | undefined,
  storeId: string,
): Promise<void> {
  if (!archive) return;
  try {
    await archive.deleteStore(storeId);
  } catch {
    logger.warn('Could not remove a deleted media archive');
  }
}

import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Storage keys are code-generated (`media/<owner>/<asset>/<label>.webp`), but a
// URL segment still reaches this function, so every path is rebuilt from
// validated segments and checked against its root. Symbolic links are refused
// because they could escape the root after validation. Shared by the live local
// provider and the archive tier so both enforce exactly the same rules.
export async function safeStoragePath(
  root: string,
  key: string,
  create = false,
): Promise<string> {
  const segments = key.split('/');
  if (
    !key ||
    key.length > 512 ||
    !/^[a-zA-Z0-9_./-]+$/.test(key) ||
    segments.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new BadRequestException('Invalid storage key');
  }
  const file = path.resolve(root, ...segments);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new BadRequestException('Invalid storage key');
  if (create) await fs.mkdir(root, { recursive: true });
  const rootInfo = await fs.lstat(root);
  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    path.relative(await fs.realpath(root), root) !== ''
  )
    throw new BadRequestException('Invalid storage directory');
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]!);
    try {
      const entry = await fs.lstat(current);
      if (
        entry.isSymbolicLink() ||
        (i < segments.length - 1 && !entry.isDirectory())
      )
        throw new BadRequestException('Invalid storage key');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (create && i < segments.length - 1) {
        await fs.mkdir(current).catch((mkdirError: NodeJS.ErrnoException) => {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        });
        const entry = await fs.lstat(current);
        if (entry.isSymbolicLink() || !entry.isDirectory())
          throw new BadRequestException('Invalid storage key');
      }
    }
  }
  return file;
}

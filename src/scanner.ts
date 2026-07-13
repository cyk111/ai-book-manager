// ============================================================
// File Scanner — recursive directory scan, SHA256 dedup
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { BookRecord } from './models';
import { detectFormat, sanitizeTitle, generateBookId } from './utils/path-utils';
import { ScanError, generateCorrelationId } from './errors';
import { Logger, NOOP_LOGGER } from './logger';

// ---- Private helpers ----

/** Quick hash of the first 64KB of a file for fast dedup. */
function hashFileHead(filePath: string): string {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  return crypto
    .createHash('sha256')
    .update(buffer.subarray(0, bytesRead))
    .digest('hex')
    .slice(0, 16);
}

// ---- Types ----

export interface ScanResult {
  books: BookRecord[];
  totalFound: number;
  newBooks: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface WalkState {
  errors: string[];
  newBooks: BookRecord[];
  totalFound: number;
  skipped: number;
  failed: number;
  knownHashes: Set<string>;
  formats: string[];
  log: Logger;
  cid: string;
}

// ---- Main scan function ----

export function runScanner(
  bookDir: string,
  formats: string[],
  existingBooks: Map<string, BookRecord> = new Map(),
  logger: Logger = NOOP_LOGGER,
): ScanResult {
  const cid = generateCorrelationId();
  logger.info('Scan started', { directory: bookDir, formats });

  // Build set of known hashes for fast dedup
  const knownHashes = new Set<string>();
  for (const [, book] of existingBooks) {
    knownHashes.add(book.fileHash);
  }

  const state: WalkState = {
    errors: [],
    newBooks: [],
    totalFound: 0,
    skipped: 0,
    failed: 0,
    knownHashes,
    formats,
    log: logger,
    cid,
  };

  walk(bookDir, state);

  logger.info('Scan completed', {
    totalFound: state.totalFound,
    newBooks: state.newBooks.length,
    skipped: state.skipped,
    failed: state.failed,
  });

  return {
    books: state.newBooks,
    totalFound: state.totalFound,
    newBooks: state.newBooks.length,
    skipped: state.skipped,
    failed: state.failed,
    errors: state.errors,
  };
}

// ---- Internal walker ----

function walk(dir: string, state: WalkState): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const msg = `Cannot read directory: ${dir} — ${String(err)}`;
    state.errors.push(msg);
    state.log.warn('Directory read failed', { directory: dir, error: String(err) });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, state);
      continue;
    }

    // Skip non-file entries (sockets, FIFOs, etc.)
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const fmt = detectFormat(ext);
    if (!fmt || !state.formats.includes(ext)) continue;

    state.totalFound++;

    try {
      const stat = fs.statSync(fullPath);
      const hash = hashFileHead(fullPath);

      if (state.knownHashes.has(hash)) {
        state.skipped++;
        state.log.debug('Duplicate skipped', { file: entry.name, hash });
        continue;
      }
      state.knownHashes.add(hash);

      const now = Date.now();
      const book: BookRecord = {
        id: generateBookId(hash),
        fileName: entry.name,
        filePath: fullPath,
        format: fmt,
        fileSize: stat.size,
        fileHash: hash,
        modifiedAt: stat.mtimeMs,
        title: sanitizeTitle(entry.name),
        author: null,
        tags: [],
        notePath: null,
        source: '本地书籍',
        sourcePath: null,
        createdAt: now,
        updatedAt: now,
      };

      state.newBooks.push(book);
      state.log.debug('Book found', { title: book.title, format: book.format });
    } catch (err) {
      state.failed++;
      const msg = `Failed to process: ${fullPath} — ${String(err)}`;
      state.errors.push(msg);
      state.log.warn('File processing failed', { filePath: fullPath, error: String(err) });
    }
  }
}

// ---- Validation ----

/**
 * Validate that the given directory exists and is accessible.
 * Throws ScanError on failure.
 */
export function validateBookDirectory(dir: string, cid?: string): void {
  const correlationId = cid || generateCorrelationId();

  if (!dir || dir.trim() === '') {
    throw new ScanError(
      'Book directory not configured',
      correlationId,
      { directory: dir },
    );
  }

  if (!fs.existsSync(dir)) {
    throw new ScanError(
      `Directory does not exist: ${dir}`,
      correlationId,
      { directory: dir },
    );
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new ScanError(
      `Path is not a directory: ${dir}`,
      correlationId,
      { directory: dir },
    );
  }
}

// ---- Verification (POC compatibility) ----

export function verifyFileSystemAccess(bookDir: string): string {
  if (!bookDir) {
    return '❌ No book directory configured. Set it in plugin settings.';
  }

  try {
    validateBookDirectory(bookDir);
  } catch (err) {
    return `❌ ${(err as Error).message}`;
  }

  const result = runScanner(bookDir, ['.pdf', '.epub', '.txt']);

  const lines = [
    '✅ File system access: OK',
    `📂 Directory: ${bookDir}`,
    `📚 Total books found: ${result.totalFound}`,
    `🆕 New books: ${result.newBooks}`,
    `⏭️  Skipped (duplicates): ${result.skipped}`,
    `❌ Failed: ${result.failed}`,
  ];

  if (result.errors.length > 0) {
    lines.push(`⚠️  Errors (${result.errors.length}):`);
    result.errors.slice(0, 5).forEach(e => lines.push(`   - ${e}`));
  }

  return lines.join('\n');
}

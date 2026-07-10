// ============================================================
// Path Utilities — cross-platform file path helpers
// ============================================================

import * as path from 'path';
import { BookFormat } from '../models';

/** Map file extension to BookFormat */
export function detectFormat(ext: string): BookFormat | null {
  const map: Record<string, BookFormat> = {
    '.pdf': 'pdf',
    '.epub': 'epub',
    '.txt': 'txt',
  };
  return map[ext.toLowerCase()] || null;
}

/** Sanitize a filename for use as a note title (remove FS-unsafe chars) */
export function sanitizeTitle(fileName: string): string {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
}

/** Extract candidate title from file path (basename without extension) */
export function extractTitleFromPath(filePath: string): string {
  const base = filePath.replace(/\.[^.]+$/, '');
  return base.split(/[/\\]/).pop() || base;
}

/** Check if a file path exists and is readable */
export function isReadablePath(filePath: string): boolean {
  try {
    const fs = require('fs');
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Generate a unique book ID from file hash */
export function generateBookId(fileHash: string): string {
  return `book_${fileHash}`;
}

/** Build a vault-relative note path for a book */
export function buildNotePath(notesFolder: string, title: string): string {
  const safeName = sanitizeTitle(title);
  return `${notesFolder}/${safeName}.md`;
}

// ============================================================
// Book Parser — Extract text from PDF/EPUB/TXT files
// ============================================================

import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { BookFormat } from './models';
import { extractTitleFromPath } from './utils/path-utils';
import { detectFormat } from './utils/path-utils';
import { ParseError, generateCorrelationId } from './errors';
import { Logger, NOOP_LOGGER } from './logger';

// ---- Types ----

export interface ParserResult {
  title: string;
  author: string | null;
  previewText: string;
  textLength: number;
  format: BookFormat;
  warnings: string[];
}

export interface ParserOptions {
  maxPages: number;
}

const DEFAULT_OPTIONS: ParserOptions = { maxPages: 3 };

// ---- Dispatch ----

export async function parseBook(
  filePath: string,
  format: BookFormat,
  maxPagesOrOptions: number | ParserOptions = DEFAULT_OPTIONS,
  logger: Logger = NOOP_LOGGER,
): Promise<ParserResult> {
  const options: ParserOptions = typeof maxPagesOrOptions === 'number'
    ? { maxPages: maxPagesOrOptions }
    : maxPagesOrOptions;
  const cid = generateCorrelationId();
  logger.info('Parsing book', { filePath, format });

  switch (format) {
    case 'txt':
      return parseTextFile(filePath, options.maxPages);
    case 'pdf':
      return parsePdfFile(filePath, options.maxPages, logger, cid);
    case 'epub':
      return parseEpubFile(filePath, options.maxPages, logger, cid);
    default:
      throw new ParseError(
        `Unsupported format: ${format}`,
        cid,
        { filePath, format },
      );
  }
}

// ---- Full Text Extraction (for skill generation) ----

const FULL_TEXT_MAX_CHARS = 200_000;

/**
 * Extract the FULL book text for skill generation.
 * Unlike parseBook() which only reads a preview (first 3 pages),
 * this reads the entire book up to 200K chars.
 */
export async function extractFullText(
  filePath: string,
  format: BookFormat,
  logger: Logger = NOOP_LOGGER,
): Promise<string> {
  const cid = generateCorrelationId();
  logger.info('Extracting full text', { filePath, format });

  switch (format) {
    case 'txt':
      return extractFullTextFromTxt(filePath);
    case 'pdf':
      return extractFullTextFromPdf(filePath, logger, cid);
    case 'epub':
      return extractFullTextFromEpub(filePath, logger, cid);
    default:
      throw new ParseError(
        `Unsupported format for full extraction: ${format}`,
        cid,
        { filePath, format },
      );
  }
}

function extractFullTextFromTxt(filePath: string): string {
  const buffer = fs.readFileSync(filePath, 'utf-8');
  return buffer.slice(0, FULL_TEXT_MAX_CHARS);
}

async function extractFullTextFromPdf(
  filePath: string,
  logger: Logger,
  cid: string,
): Promise<string> {
  const textParts: string[] = [];
  let totalChars = 0;

  try {
    const pdfjsLib = await import('pdfjs-dist');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;

    for (let i = 1; i <= doc.numPages && totalChars < FULL_TEXT_MAX_CHARS; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: unknown) => {
          const textItem = item as { str?: string };
          return textItem.str || '';
        })
        .join(' ');
      textParts.push(pageText);
      totalChars += pageText.length;
    }

    const fullText = textParts.join('\n\n');
    logger.debug('PDF full text extracted', {
      pagesRead: Math.min(textParts.length, doc.numPages),
      textLength: fullText.length,
    });
    return fullText.slice(0, FULL_TEXT_MAX_CHARS);
  } catch (err) {
    logger.warn('PDF full text extraction failed', {
      filePath,
      error: String(err),
    });
    throw new ParseError(
      `PDF full text extraction failed: ${String(err)}`,
      cid,
      { filePath },
    );
  }
}

function extractFullTextFromEpub(
  filePath: string,
  logger: Logger,
  cid: string,
): string {
  const textParts: string[] = [];
  let totalChars = 0;

  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (!entry.entryName.endsWith('.xhtml') && !entry.entryName.endsWith('.html')) continue;
      if (totalChars >= FULL_TEXT_MAX_CHARS) break;

      let content = entry.getData().toString('utf-8');

      // Strip HTML tags, keep text
      const text = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 20) {
        textParts.push(text);
        totalChars += text.length;
      }
    }

    const fullText = textParts.join('\n\n');
    logger.debug('EPUB full text extracted', { sections: textParts.length, textLength: fullText.length });
    return fullText.slice(0, FULL_TEXT_MAX_CHARS);
  } catch (err) {
    logger.warn('EPUB full text extraction failed', {
      filePath,
      error: String(err),
    });
    throw new ParseError(
      `EPUB full text extraction failed: ${String(err)}`,
      cid,
      { filePath },
    );
  }
}

// ---- TXT Parser ----

function parseTextFile(filePath: string, maxPages: number): ParserResult {
  const warnings: string[] = [];
  const buffer = fs.readFileSync(filePath, 'utf-8');
  const text = buffer.slice(0, maxPages * 3000);

  return {
    title: extractTitleFromPath(filePath),
    author: null,
    previewText: text,
    textLength: buffer.length,
    format: 'txt',
    warnings,
  };
}

// ---- Garbage title detection ----

/**
 * Get the best title: filename first, metadata only if it agrees.
 *
 * Strategy:
 *   1. Always start with filename (user's intentional naming)
 *   2. If metadata title is very similar to filename → use metadata (cleaned up)
 *   3. If metadata title is completely different → ignore it (likely garbage)
 */
function pickBestTitle(metadataTitle: string | null, filePath: string): string {
  const fileTitle = extractTitleFromPath(filePath);
  if (!metadataTitle) return fileTitle;

  const cleaned = metadataTitle.trim();
  if (cleaned.length < 2) return fileTitle;

  // Normalize both for comparison
  const normMeta = cleaned.toLowerCase().replace(/[\s\-_.,，。、：；！？《》【】\[\]\(\)（）]+/g, '');
  const normFile = fileTitle.toLowerCase().replace(/[\s\-_.,，。、：；！？《》【】\[\]\(\)（）]+/g, '');

  // Exact match after normalization → metadata is just a formatted version
  if (normMeta === normFile) return fileTitle;

  // Metadata contains filename → metadata adds extra info (author etc.)
  if (normMeta.includes(normFile) || normFile.includes(normMeta)) return cleaned;

  // Both are short — metadata might be a better version
  if (cleaned.length <= 8 && fileTitle.length <= 8) return cleaned;

  // Metadata is completely different and filename is meaningful → trust filename
  return fileTitle;
}

// ---- PDF Parser (pdfjs-dist dynamic import) ----

async function parsePdfFile(
  filePath: string,
  maxPages: number,
  logger: Logger,
  cid: string,
): Promise<ParserResult> {
  const warnings: string[] = [];
  const fileTitle = extractTitleFromPath(filePath);
  let author: string | null = null;
  const textParts: string[] = [];
  let metadataTitle: string | null = null;

  try {
    const pdfjsLib = await import('pdfjs-dist');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;

    // Extract metadata
    try {
      const metadata = await doc.getMetadata();
      if (metadata?.info) {
        const info = metadata.info as Record<string, unknown>;
        if (info.Title && typeof info.Title === 'string') metadataTitle = info.Title;
        if (info.Author && typeof info.Author === 'string') author = info.Author;
      }
    } catch {
      warnings.push('Failed to extract PDF metadata.');
    }

    // Extract first N pages
    const pagesToRead = Math.min(maxPages, doc.numPages);
    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: unknown) => {
          const textItem = item as { str?: string };
          return textItem.str || '';
        })
        .join(' ');
      textParts.push(pageText);
    }

    const previewText = textParts.join('\n\n');
    if (previewText.trim().length === 0) {
      warnings.push(
        'No extractable text — this PDF may be a scanned/image-based file. ' +
          'AI classification will rely on filename only.',
      );
    }

    const title = pickBestTitle(metadataTitle, filePath);
    logger.debug('PDF parsed', { title, pagesRead: pagesToRead, textLength: previewText.length });
    return { title, author, previewText, textLength: previewText.length, format: 'pdf', warnings };
  } catch (err) {
    logger.warn('PDF parsing failed, falling back to filename', {
      filePath,
      error: String(err),
    });
    warnings.push(`PDF parsing failed: ${String(err)}. Using filename only.`);
    return { title: fileTitle, author: null, previewText: '', textLength: 0, format: 'pdf', warnings };
  }
}

// ---- EPUB Parser ----

function parseEpubFile(
  filePath: string,
  maxPages: number,
  logger: Logger,
  cid: string,
): ParserResult {
  const warnings: string[] = [];
  const fileTitle = extractTitleFromPath(filePath);
  let metadataTitle: string | null = null;
  const textParts: string[] = [];

  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (!entry.entryName.endsWith('.xhtml') && !entry.entryName.endsWith('.html')) continue;
      if (textParts.length >= maxPages * 2) break;

      let content = entry.getData().toString('utf-8');

      // Try to extract title from <title> tag
      if (!metadataTitle) {
        const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) metadataTitle = titleMatch[1].trim();
      }

      // Strip HTML tags, keep text
      const text = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length > 50) {
        textParts.push(text.slice(0, 1500));
      }
    }

    const previewText = textParts.join('\n\n');
    if (previewText.trim().length === 0) {
      warnings.push('No extractable text from EPUB — file may be DRM-protected or image-based.');
    }

    const title = pickBestTitle(metadataTitle, filePath);
    logger.debug('EPUB parsed', { title, sections: textParts.length, textLength: previewText.length });
    return { title, author: null, previewText, textLength: previewText.length, format: 'epub', warnings };
  } catch (err) {
    logger.warn('EPUB parsing failed, falling back to filename', {
      filePath,
      error: String(err),
    });
    warnings.push(`EPUB parsing failed: ${String(err)}. Using filename only.`);
    return { title: fileTitle, author: null, previewText: '', textLength: 0, format: 'epub', warnings };
  }
}

// ---- Verification ----

export async function verifyBookParsing(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    return `❌ File not found: ${filePath}`;
  }

  const ext = filePath.split('.').pop()?.toLowerCase();
  const format = detectFormat(`.${ext}`);

  if (!format) {
    return `❌ Unsupported format: .${ext}`;
  }

  try {
    const result = await parseBook(filePath, format);

    const lines = [
      '✅ Book parsing: OK',
      `📖 Title: ${result.title}`,
      `👤 Author: ${result.author || 'unknown'}`,
      `📝 Preview text length: ${result.textLength} chars`,
      `📄 Format: ${result.format}`,
      '',
      '--- Preview (first 300 chars) ---',
      result.previewText.slice(0, 300),
    ];

    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('⚠️  Warnings:');
      result.warnings.forEach(w => lines.push(`   - ${w}`));
    }

    return lines.join('\n');
  } catch (err) {
    return `❌ Parse error: ${String(err)}`;
  }
}

// ============================================================
// Metadata Extractor — extract book metadata from markdown
// ============================================================
// Supports multiple source formats:
//   - YAML frontmatter (weread, kindle, most plugins)
//   - Inline Key:: Value pairs (iBook plugin)
//   - Filename fallback
// ============================================================

export interface ExtractedMetadata {
  title: string;
  author: string | null;
  isbn: string | null;
  cover: string | null;
  /** Original format-specific book ID (e.g. weread bookId, ibook assetId) */
  sourceId: string | null;
  /** Raw category/classification from source (e.g. "精品小说-悬疑推理") */
  sourceCategory: string | null;
  /** Raw content of the source markdown file */
  rawContent: string;
}

/**
 * Extract book metadata from a markdown file's content.
 * Tries frontmatter first, then inline :: fields, then filename.
 */
export function extractMetadata(content: string, fileName: string, sourceName: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {
    title: '',
    author: null,
    isbn: null,
    cover: null,
    sourceId: null,
    sourceCategory: null,
    rawContent: content,
  };

  // 1. Try YAML frontmatter
  const fm = parseFrontMatter(content);
  if (fm) {
    meta.title = fm.title || fm.Title || '';
    meta.author = fm.author || fm.Author || null;
    meta.isbn = fm.isbn || fm.ISBN || null;
    meta.cover = fm.cover || fm.Cover || null;

    // Source-specific IDs
    if (sourceName === '微信读书') {
      meta.sourceId = fm.bookId || null;
      meta.sourceCategory = fm.category || null;
    }

    // Extract source category from metadata section
    if (!meta.sourceCategory && fm.category) {
      meta.sourceCategory = fm.category;
    }
  }

  // 2. Try inline Key:: Value pairs (iBook format, fallback)
  if (!meta.title) {
    meta.title = extractInlineField(content, 'Title') || '';
  }
  if (!meta.author) {
    meta.author = extractInlineField(content, 'Author') || null;
  }

  // Extract iBook assetId from Link field
  if (!meta.sourceId && sourceName === 'iBook') {
    const link = extractInlineField(content, 'Link');
    if (link) {
      const match = link.match(/assetid\/([A-F0-9]+)/i);
      if (match) meta.sourceId = match[1];
    }
  }

  // 3. Extract category from inline metadata (weread "分类" field inside # 元数据 section)
  if (!meta.sourceCategory) {
    meta.sourceCategory = extractCategoryFromContent(content);
  }

  // 4. Filename fallback
  if (!meta.title) {
    meta.title = stripExtension(fileName);
  }

  // 5. Clean title (remove publisher suffixes, normalize)
  meta.title = cleanTitle(meta.title);

  return meta;
}

// ---- Frontmatter Parser ----

function parseFrontMatter(content: string): Record<string, string> | null {
  // Match YAML frontmatter: starts with ---, ends with ---
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, string> = {};

  // Simple key: value parser (handles quoted and unquoted values)
  const lines = yaml.split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+?)\s*$/);
    if (kv) {
      let val = kv[2].trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[kv[1]] = val;
    }
  }

  return result;
}

// ---- Inline Field Parser (iBook format: "Title:: value") ----

function extractInlineField(content: string, field: string): string | null {
  const regex = new RegExp(`^${field}::\\s*(.+)$`, 'im');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

// ---- Category Extraction from Content ----

function extractCategoryFromContent(content: string): string | null {
  // Weread format: "分类： 精品小说-悬疑推理" inside metadata section
  const catMatch = content.match(/分类[：:]\s*(.+)/);
  if (catMatch) return catMatch[1].trim();

  // Other formats: "Category: xxx"
  const catMatch2 = content.match(/Category[：:]\s*(.+)/i);
  if (catMatch2) return catMatch2[1].trim();

  return null;
}

// ---- Title Normalization ----

/**
 * Normalize a book title for matching:
 * - Remove parenthetical notes like "(全集)", "(第2版)"
 * - Normalize fullwidth→halfwidth
 * - Lowercase
 * - Remove decorative punctuation
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[（(][^)）]*[）)]/g, '')  // Remove parenthetical content
    .replace(/[：:：]/g, '')              // Remove colons
    .replace(/[《》「」『』""'']/g, '')   // Remove quote marks
    .replace(/[【】]/g, '')               // Remove brackets
    .replace(/[！!？?。，,、；;]/g, '')   // Remove punctuation
    .replace(/[！-～]/g, (c) =>  // Fullwidth→halfwidth
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\./g, '')                   // Remove dots
    .replace(/\s+/g, '')                  // Remove whitespace
    .toLowerCase()
    .trim();
}

/**
 * Normalize author name for matching.
 */
export function normalizeAuthor(author: string): string {
  return author
    .replace(/[（(][^)）]*[）)]/g, '')  // Remove "(著)", "(译)" etc.
    .replace(/\s+/g, '')
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .trim();
}

// ---- Helpers ----

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function cleanTitle(title: string): string {
  // Remove common suffixes that aren't part of the title
  return title
    .replace(/\s*tg@\S+\s*/gi, '')       // Remove share tags like "tg@sharebooks4you"
    .replace(/\s*-\s*$/, '')              // Remove trailing dash
    .trim();
}

// ============================================================
// Book Matcher — cross-source book matching
// ============================================================
// Matches books across different sources using:
//   1. ISBN exact match (confidence: 100%)
//   2. Title + author normalized match (confidence: 95%)
//   3. Title-only normalized match (confidence: 80%)
// ============================================================

import { BookRecord } from '../models';
import { normalizeTitle, normalizeAuthor } from './metadata-extractor';

// ---- Types ----

export interface MatchResult {
  /** The matched book from another source */
  book: BookRecord;
  /** Match confidence level */
  confidence: 'isbn' | 'title_author' | 'title_only';
}

export interface MatchGroup {
  /** All books that belong to the same group (different sources, same book) */
  books: BookRecord[];
  /** Match confidence for this group */
  confidence: 'isbn' | 'title_author' | 'title_only';
}

// ---- Matching ----

/**
 * Find all matching books for a given book across all known books.
 * Returns matches sorted by confidence (highest first).
 */
export function findMatches(
  target: BookRecord,
  allBooks: BookRecord[],
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const candidate of allBooks) {
    // Don't match against self
    if (candidate.id === target.id) continue;
    // Don't match against same source
    if (candidate.source === target.source) continue;

    const confidence = matchConfidence(target, candidate);
    if (confidence) {
      results.push({ book: candidate, confidence });
    }
  }

  // Sort by confidence
  const order: Record<string, number> = { isbn: 0, title_author: 1, title_only: 2 };
  results.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return results;
}

/**
 * Build match groups across all books.
 * Each group represents the same book across different sources.
 */
export function buildMatchGroups(allBooks: BookRecord[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  const visited = new Set<string>();

  for (const book of allBooks) {
    if (visited.has(book.id)) continue;

    const group: BookRecord[] = [book];
    let bestConfidence: MatchResult['confidence'] | null = null;

    for (const other of allBooks) {
      if (other.id === book.id || visited.has(other.id)) continue;
      if (other.source === book.source) continue;

      const conf = matchConfidence(book, other);
      if (conf) {
        group.push(other);
        visited.add(other.id);
        if (!bestConfidence || confidenceOrder(conf) < confidenceOrder(bestConfidence)) {
          bestConfidence = conf;
        }
      }
    }

    visited.add(book.id);

    if (group.length > 1) {
      groups.push({
        books: group,
        confidence: bestConfidence || 'title_only',
      });
    }
  }

  return groups;
}

// ---- Confidence Calculation ----

function matchConfidence(a: BookRecord, b: BookRecord): MatchResult['confidence'] | null {
  // 1. ISBN exact match (both must be non-null)
  // ISBN is stored in note frontmatter — for now we use title+author
  // TODO: add ISBN to BookRecord when available

  // 2. Title + author normalized match
  const normTitleA = normalizeTitle(a.title);
  const normTitleB = normalizeTitle(b.title);

  if (!normTitleA || !normTitleB) return null;

  if (normTitleA === normTitleB) {
    if (a.author && b.author) {
      const normAuthorA = normalizeAuthor(a.author);
      const normAuthorB = normalizeAuthor(b.author);
      if (normAuthorA === normAuthorB) {
        return 'title_author';
      }
    }
    // Title matches but at least one author missing
    return 'title_only';
  }

  // 3. Fuzzy: one title contains the other
  if (normTitleA.includes(normTitleB) || normTitleB.includes(normTitleA)) {
    return 'title_only';
  }

  return null;
}

function confidenceOrder(c: MatchResult['confidence']): number {
  return { isbn: 0, title_author: 1, title_only: 2 }[c];
}

// ---- Link Generation ----

/**
 * Generate a wikilink to another book's note.
 */
export function makeBookLink(book: BookRecord): string {
  if (!book.notePath) return `[[${book.title}]]`;

  // Extract just the note name (without path and extension)
  const fileName = book.notePath.split('/').pop()?.replace(/\.md$/, '') || book.title;

  // Use vault-relative path for wikilink
  return `[[${book.notePath.replace(/\.md$/, '')}|${book.title}]]`;
}

/**
 * Generate the "related books" section for a note.
 */
export function generateRelatedSection(
  book: BookRecord,
  matches: MatchResult[],
): string {
  if (matches.length === 0) return '';

  const lines: string[] = [];
  lines.push('📎 关联资源：');

  for (const match of matches) {
    const link = makeBookLink(match.book);
    const icon = sourceIcon(match.book.source);
    const warn = match.confidence === 'title_only' ? ' ⚠️待确认' : '';
    lines.push(`  ${icon} ${link}${warn}`);
  }

  return lines.join('\n');
}

function sourceIcon(source: string): string {
  switch (source) {
    case '本地书籍': return '📁';
    case '微信读书': return '💬';
    case 'iBook': return '🍎';
    default: return '📄';
  }
}

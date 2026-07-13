// ============================================================
// Unit Tests: Book Matcher — cross-source book matching
// ============================================================

import { BookRecord } from '../models';
import { findMatches, buildMatchGroups, generateRelatedSection } from '../utils/book-matcher';

function makeBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book_test',
    fileName: 'test.md',
    filePath: '/tmp/test.md',
    format: 'md',
    fileSize: 100,
    fileHash: 'hash_test',
    modifiedAt: Date.now(),
    title: 'Test',
    author: null,
    tags: [],
    notePath: '📚图书库/test/test.md',
    source: '测试',
    sourcePath: null,
    skillPath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('findMatches', () => {
  it('should_match_same_title_and_author_across_sources', () => {
    const book1 = makeBook({
      id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣',
      notePath: '📚图书库/本地书籍/科幻/三体.md',
    });
    const book2 = makeBook({
      id: 'b', source: '微信读书', title: '三体', author: '刘慈欣',
      notePath: '📚图书库/微信读书/科幻/三体.md',
    });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('title_author');
    expect(matches[0].book.id).toBe('b');
  });

  it('should_match_title_only_when_author_missing', () => {
    const book1 = makeBook({
      id: 'a', source: '本地书籍', title: '嫌疑人X的献身', author: '东野圭吾',
    });
    const book2 = makeBook({
      id: 'b', source: 'iBook', title: '嫌疑人X的献身', author: null,
    });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('title_only');
  });

  it('should_not_match_self', () => {
    const book = makeBook({ id: 'a', title: '三体', author: '刘慈欣' });
    const matches = findMatches(book, [book]);
    expect(matches).toHaveLength(0);
  });

  it('should_not_match_same_source', () => {
    const book1 = makeBook({ id: 'a', source: '微信读书', title: '三体' });
    const book2 = makeBook({ id: 'b', source: '微信读书', title: '三体' });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(0);
  });

  it('should_not_match_completely_different_books', () => {
    const book1 = makeBook({ id: 'a', title: '三体', author: '刘慈欣', source: '本地书籍' });
    const book2 = makeBook({ id: 'b', title: '解忧杂货店', author: '东野圭吾', source: '微信读书' });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(0);
  });

  it('should_match_normalized_titles', () => {
    const book1 = makeBook({
      id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣',
    });
    const book2 = makeBook({
      id: 'b', source: '微信读书', title: '三体（全集）', author: '刘慈欣',
    });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('title_author');
  });

  it('should_match_when_one_title_contains_the_other', () => {
    const book1 = makeBook({
      id: 'a', source: '本地书籍', title: '大明王朝1566',
    });
    const book2 = makeBook({
      id: 'b', source: '微信读书', title: '大明王朝1566（全集）',
    });

    const matches = findMatches(book1, [book2]);
    expect(matches).toHaveLength(1);
  });

  it('should_sort_matches_by_confidence', () => {
    const book1 = makeBook({
      id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣',
    });
    const book2 = makeBook({
      id: 'b', source: '微信读书', title: '三体', author: null,
    });
    const book3 = makeBook({
      id: 'c', source: 'iBook', title: '三体', author: '刘慈欣',
    });

    const matches = findMatches(book1, [book2, book3]);
    expect(matches).toHaveLength(2);
    // title_author before title_only
    expect(matches[0].confidence).toBe('title_author');
    expect(matches[1].confidence).toBe('title_only');
  });
});

describe('buildMatchGroups', () => {
  it('should_group_books_across_multiple_sources', () => {
    const books = [
      makeBook({ id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣' }),
      makeBook({ id: 'b', source: '微信读书', title: '三体', author: '刘慈欣' }),
      makeBook({ id: 'c', source: 'iBook', title: '三体', author: '刘慈欣' }),
    ];

    const groups = buildMatchGroups(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].books).toHaveLength(3);
    expect(groups[0].confidence).toBe('title_author');
  });

  it('should_not_group_unrelated_books', () => {
    const books = [
      makeBook({ id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣' }),
      makeBook({ id: 'b', source: '微信读书', title: '解忧杂货店', author: '东野圭吾' }),
    ];

    const groups = buildMatchGroups(books);
    expect(groups).toHaveLength(0);
  });

  it('should_handle_empty_list', () => {
    const groups = buildMatchGroups([]);
    expect(groups).toHaveLength(0);
  });
});

describe('generateRelatedSection', () => {
  it('should_generate_links_to_matched_books', () => {
    const book = makeBook({
      id: 'a', source: '本地书籍', title: '三体', author: '刘慈欣',
      notePath: '📚图书库/本地书籍/科幻/三体.md',
    });
    const match1 = makeBook({
      id: 'b', source: '微信读书', title: '三体', author: '刘慈欣',
      notePath: '📚图书库/微信读书/科幻/三体.md',
    });
    const match2 = makeBook({
      id: 'c', source: 'iBook', title: '三体', author: '刘慈欣',
      notePath: '📚图书库/iBook/科幻/三体.md',
    });

    const section = generateRelatedSection(book, [
      { book: match1, confidence: 'title_author' },
      { book: match2, confidence: 'title_author' },
    ]);

    expect(section).toContain('📎 关联资源');
    expect(section).toContain('微信读书');
    expect(section).toContain('iBook');
    expect(section).not.toContain('⚠️'); // No warning for title_author matches
  });

  it('should_add_warning_for_low_confidence_matches', () => {
    const book = makeBook({
      id: 'a', source: '本地书籍', title: '三体',
    });
    const match = makeBook({
      id: 'b', source: 'iBook', title: '三体', author: null,
    });

    const section = generateRelatedSection(book, [
      { book: match, confidence: 'title_only' },
    ]);

    expect(section).toContain('⚠️待确认');
  });

  it('should_return_empty_for_no_matches', () => {
    const book = makeBook({ title: '三体' });
    const section = generateRelatedSection(book, []);
    expect(section).toBe('');
  });
});

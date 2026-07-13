// ============================================================
// Unit Tests: Metadata Extractor — markdown metadata extraction
// ============================================================

import { extractMetadata, normalizeTitle, normalizeAuthor } from '../utils/metadata-extractor';

describe('Metadata Extractor', () => {
  // --------------------------------------------------------
  // Frontmatter (Weread format)
  // --------------------------------------------------------
  describe('YAML frontmatter', () => {
    const wereadContent = `---
doc_type: weread-highlights-reviews
bookId: "230110"
title: 嫌疑人X的献身
author: 东野圭吾
isbn: 9787544245555
cover: https://cdn.example.com/cover.jpg
category: 精品小说-悬疑推理
---

# 元数据
> - 书名： 嫌疑人X的献身
> - 作者： 东野圭吾
`;

    it('should_extract_title_from_frontmatter', () => {
      const meta = extractMetadata(wereadContent, '嫌疑人X的献身.md', '微信读书');
      expect(meta.title).toBe('嫌疑人X的献身');
    });

    it('should_extract_author_from_frontmatter', () => {
      const meta = extractMetadata(wereadContent, 'file.md', '微信读书');
      expect(meta.author).toBe('东野圭吾');
    });

    it('should_extract_isbn_from_frontmatter', () => {
      const meta = extractMetadata(wereadContent, 'file.md', '微信读书');
      expect(meta.isbn).toBe('9787544245555');
    });

    it('should_extract_bookId_for_weread', () => {
      const meta = extractMetadata(wereadContent, 'file.md', '微信读书');
      expect(meta.sourceId).toBe('230110');
    });
  });

  // --------------------------------------------------------
  // Inline Key:: Value (iBook format)
  // --------------------------------------------------------
  describe('inline Key:: Value', () => {
    const ibookContent = `Title:: 📕 The Common Path to Uncommon Success
Author:: John Lee Dumas
Link:: [Apple Books Link](ibooks://assetid/8F9EB93027EB5EF6862AF9E4A282670F)

## Annotations
- 📖 Chapter:: N/A
- 🎯 Highlight:: Some highlighted text
- 📝 Note:: My personal note
`;

    it('should_extract_title_from_inline_field', () => {
      const meta = extractMetadata(ibookContent, 'The Common Path to Uncommon Success.md', 'iBook');
      expect(meta.title).toBe('📕 The Common Path to Uncommon Success');
    });

    it('should_extract_author_from_inline_field', () => {
      const meta = extractMetadata(ibookContent, 'file.md', 'iBook');
      expect(meta.author).toBe('John Lee Dumas');
    });

    it('should_extract_assetId_for_ibook', () => {
      const meta = extractMetadata(ibookContent, 'file.md', 'iBook');
      expect(meta.sourceId).toBe('8F9EB93027EB5EF6862AF9E4A282670F');
    });
  });

  // --------------------------------------------------------
  // Fallback: filename
  // --------------------------------------------------------
  describe('filename fallback', () => {
    it('should_use_filename_when_no_metadata_found', () => {
      const content = '# Just a title\n\nSome content without any metadata';
      const meta = extractMetadata(content, '三体.md', '未知');
      expect(meta.title).toBe('三体');
    });

    it('should_strip_file_extension', () => {
      const meta = extractMetadata('no metadata', '嫌疑人X的献身.md', '未知');
      expect(meta.title).toBe('嫌疑人X的献身');
    });

    it('should_handle_no_metadata_at_all', () => {
      const meta = extractMetadata('', 'hello.md', '未知');
      expect(meta.title).toBe('hello');
      expect(meta.author).toBeNull();
      expect(meta.isbn).toBeNull();
    });
  });

  // --------------------------------------------------------
  // Priority: frontmatter > inline > filename
  // --------------------------------------------------------
  describe('extraction priority', () => {
    it('should_prefer_frontmatter_over_filename', () => {
      const content = `---
title: 三体
author: 刘慈欣
---

# 三体
`;
      const meta = extractMetadata(content, 'wrong_filename.md', '微信读书');
      expect(meta.title).toBe('三体');
      expect(meta.author).toBe('刘慈欣');
    });

    it('should_strip_tg_share_tags_from_title', () => {
      const content = `---
title: 芯片战争：世界最关键技术的争夺战 tg@sharebooks4you
---
`;
      const meta = extractMetadata(content, 'file.md', '微信读书');
      expect(meta.title).toBe('芯片战争：世界最关键技术的争夺战');
    });
  });
});

// ---- Title/Author Normalization ----

describe('normalizeTitle', () => {
  it('should_remove_parenthetical_content', () => {
    expect(normalizeTitle('三体（全集）')).toBe('三体');
    expect(normalizeTitle('嫌疑人X的献身(修订版)')).toBe('嫌疑人x的献身');
  });

  it('should_normalize_fullwidth_to_halfwidth', () => {
    expect(normalizeTitle('ＡＢＣ１２３')).toBe('abc123');
  });

  it('should_remove_punctuation_and_spaces', () => {
    expect(normalizeTitle('Python：从入门到精通')).toBe('python从入门到精通');
    expect(normalizeTitle('The Common Path to Uncommon Success'))
      .toBe('thecommonpathtouncommonsuccess');
  });

  it('should_lowercase', () => {
    expect(normalizeTitle('HELLO WORLD')).toBe('helloworld');
  });

  it('should_remove_chinese_quotes', () => {
    expect(normalizeTitle('《三体》')).toBe('三体');
  });
});

describe('normalizeAuthor', () => {
  it('should_remove_author_role_suffix', () => {
    expect(normalizeAuthor('刘慈欣(著)')).toBe('刘慈欣');
    expect(normalizeAuthor('村上春樹（訳）')).toBe('村上春樹');
  });

  it('should_remove_spaces_and_normalize_case', () => {
    expect(normalizeAuthor('John Lee Dumas')).toBe('johnleedumas');
  });

  it('should_handle_empty_author', () => {
    expect(normalizeAuthor('')).toBe('');
  });
});

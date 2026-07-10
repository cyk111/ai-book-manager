import {
  detectFormat,
  sanitizeTitle,
  extractTitleFromPath,
  generateBookId,
  buildNotePath,
} from '../utils/path-utils';

describe('detectFormat', () => {
  it('should_detect_pdf_format', () => {
    expect(detectFormat('.pdf')).toBe('pdf');
    expect(detectFormat('.PDF')).toBe('pdf');
  });

  it('should_detect_epub_format', () => {
    expect(detectFormat('.epub')).toBe('epub');
  });

  it('should_detect_txt_format', () => {
    expect(detectFormat('.txt')).toBe('txt');
  });

  it('should_return_null_for_unsupported_format', () => {
    expect(detectFormat('.mobi')).toBeNull();
    expect(detectFormat('.jpg')).toBeNull();
    expect(detectFormat('')).toBeNull();
  });
});

describe('sanitizeTitle', () => {
  it('should_remove_file_extension', () => {
    expect(sanitizeTitle('book.pdf')).toBe('book');
    expect(sanitizeTitle('my book.epub')).toBe('my book');
  });

  it('should_remove_filesystem_unsafe_characters', () => {
    // Note: / is a path separator so path.basename extracts everything after it
    expect(sanitizeTitle('c*d?e"f<g>h|i')).toBe('c-d-e-f-g-h-i');
  });

  it('should_trim_whitespace', () => {
    expect(sanitizeTitle('  book  .pdf')).toBe('book');
  });
});

describe('extractTitleFromPath', () => {
  it('should_extract_basename_without_extension', () => {
    expect(extractTitleFromPath('/path/to/book.pdf')).toBe('book');
  });

  it('should_handle_windows_paths', () => {
    expect(extractTitleFromPath('C:\\Users\\books\\test.epub')).toBe('test');
  });

  it('should_handle_no_extension', () => {
    expect(extractTitleFromPath('/path/to/README')).toBe('README');
  });
});

describe('generateBookId', () => {
  it('should_prefix_hash_with_book_', () => {
    expect(generateBookId('abc123')).toBe('book_abc123');
  });
});

describe('buildNotePath', () => {
  it('should_build_vault_relative_path', () => {
    expect(buildNotePath('📚图书库', '三体')).toBe('📚图书库/三体.md');
  });

  it('should_sanitize_title_in_path', () => {
    expect(buildNotePath('books', 'a:b.pdf')).toBe('books/a-b.md');
  });
});

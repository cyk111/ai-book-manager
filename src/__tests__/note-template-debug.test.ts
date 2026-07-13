// Debug test: verify generated note content template
import { App, Vault, MetadataCache, FileManager } from 'obsidian';
import { NoteService } from '../services/note-service';
import { BookRecord } from '../models';

test('show_generated_template', () => {
  const mockApp = new App();
  const ns = new NoteService(mockApp, '📚图书库');

  const book: BookRecord = {
    id: 'book_test123',
    fileName: '三体.pdf',
    filePath: '/Users/cyk-station/books/三体.pdf',
    format: 'pdf',
    fileSize: 2500000,
    fileHash: 'testhash12345678',
    modifiedAt: Date.now(),
    title: '三体',
    author: '刘慈欣',
    tags: ['科幻', '外星文明', '物理学'],
    notePath: null,
    source: '本地书籍',
    sourcePath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const content = ns.generateNoteContent(book);
  console.log('=== GENERATED NOTE ===');
  console.log(content);
  console.log('=== END ===');

  // Verify new format
  expect(content).toContain('年');
  expect(content).toContain('月');
  expect(content).toContain('日');
  expect(content).not.toContain('ai_summary');
  expect(content).not.toContain('toISOString');
});

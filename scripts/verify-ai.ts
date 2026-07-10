// Test TOC + chapter overview generation on one book
import { parseBook } from '../src/parser';
import { generateTOC, generateChapterContent } from '../src/ai-client';
import { runScanner } from '../src/scanner';

const config = {
  baseUrl: process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_KEY || '',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
};

async function main() {
  const result = runScanner(__dirname + '/../test-fixtures/books', ['.pdf', '.epub', '.txt']);
  if (result.books.length === 0) { console.log('No books'); return; }

  // Pick the EPUB book (has most extractable text)
  const book = result.books.find(b => b.format === 'epub') || result.books[0];

  console.log(`📖 Testing: ${book.title}\n`);

  const parsed = await parseBook(book.filePath, book.format, 5);
  console.log(`Text extracted: ${parsed.previewText.length} chars\n`);

  // Generate TOC
  console.log('=== 📋 生成目录 ===');
  const { toc, tokenUsed: tocTokens } = await generateTOC(
    config, book.title, parsed.author, parsed.previewText,
  );
  console.log(toc);
  console.log(`(Tokens: ${tocTokens})\n`);

  // Generate overview for first chapter
  const firstChapter = toc.split('\n').find(l => l.includes('第1章') || l.includes('第 1 章'));
  if (firstChapter) {
    const chapterTitle = firstChapter.replace(/-\s*/, '').trim();
    console.log(`=== 📝 概述: ${chapterTitle} ===`);
    const { content, tokenUsed: chTokens } = await generateChapterContent(
      config, book.title, chapterTitle, parsed.previewText,
    );
    console.log(content);
    console.log(`(Tokens: ${chTokens})`);
  }
}

main().catch(console.error);

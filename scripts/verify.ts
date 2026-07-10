// ============================================================
// Quick verification — process test books end-to-end
// Usage: npm run build && npx tsx scripts/verify.ts
// ============================================================

import { runScanner } from '../src/scanner';
import { parseBook } from '../src/parser';
import { classifyBook } from '../src/ai-client';

const BOOK_DIR = __dirname + '/../test-fixtures/books';
const API_KEY = process.env.DEEPSEEK_KEY || '';
const API_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1';
const API_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function main() {
  console.log('🧪 Quick Verification');
  console.log('='.repeat(60));

  // 1. Scan
  console.log('\n📂 Scan:', BOOK_DIR);
  const result = runScanner(BOOK_DIR, ['.pdf', '.epub', '.txt']);
  console.log(`   Found: ${result.totalFound}, New: ${result.newBooks}`);

  if (result.books.length === 0) {
    console.log('   No books found. Add test books to test-fixtures/books/');
    return;
  }

  // 2. Parse + classify each book
  for (const book of result.books) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📖 ${book.title}`);
    console.log(`   Format: ${book.format}, Size: ${(book.fileSize / 1024 / 1024).toFixed(1)} MB`);

    // Extract directory hint
    const parts = book.filePath.replace(/\\/g, '/').split('/');
    const parentDir = parts.length >= 2 ? parts[parts.length - 2] : '';
    const hasDirHint = parentDir && parentDir !== 'books' && parentDir !== 'test-fixtures';
    if (hasDirHint) console.log(`   📁 Directory hint: "${parentDir}"`);

    // Parse
    process.stdout.write(`   🔍 Parsing...`);
    const parsed = await parseBook(book.filePath, book.format, 3);
    console.log(` ${parsed.previewText.length} chars extracted`);
    if (parsed.author) console.log(`   👤 Author from metadata: ${parsed.author}`);
    if (parsed.warnings.length > 0) console.log(`   ⚠️  ${parsed.warnings[0]}`);

    // Classify (AI)
    if (API_KEY) {
      process.stdout.write(`   🤖 Classifying...`);
      try {
        const { result, tokenUsed } = await classifyBook(
          { baseUrl: API_URL, apiKey: API_KEY, model: API_MODEL },
          book.title,
          parsed.author,
          parsed.previewText || `${book.title}`,
          undefined,
          hasDirHint ? parentDir : undefined,
        );
        console.log(` OK (${tokenUsed} tokens)`);
        console.log(`   🏷️  Tags: [${result.tags.join(', ')}]`);
        console.log(`   📂 Category: ${result.category || 'none'}`);
        console.log(`   📁 Would move to: 📚图书库/${result.category}/${book.title}.md`);
        console.log(`   📄 Nav page: 📚图书库/${result.category}/${result.category}.md → - [[${book.title}]]`);
      } catch (err) {
        console.log(` FAILED: ${String(err).slice(0, 100)}`);
      }
    } else {
      console.log(`   ⏭️  Skipping AI (no API key). Set DEEPSEEK_KEY env var.`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Done');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});

// ============================================================
// Standalone POC verification — runs outside Obsidian
// Usage: npx ts-node poc-verify.ts
// ============================================================

import { runScanner, verifyFileSystemAccess } from './src/scanner';
import { verifyBookParsing } from './src/parser';
import { verifyAIConnection } from './src/ai-client';

const BOOK_DIR = process.env.BOOK_DIR || '';
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function runAllPOCs(): Promise<void> {
  console.log('='.repeat(60));
  console.log('AI Book Manager — POC Verification');
  console.log('='.repeat(60));

  // ---- POC-1: File System Access ----
  console.log('\n📂 POC-1: File System Access');
  console.log('-'.repeat(40));
  if (!BOOK_DIR) {
    console.log('⚠️  BOOK_DIR not set. Skipping file scan POC.');
    console.log('   Set with: export BOOK_DIR="/path/to/your/books"');
  } else {
    console.log(verifyFileSystemAccess(BOOK_DIR));
  }

  // ---- POC-2: Book Parsing ----
  console.log('\n📖 POC-2: Book Parsing (first PDF found)');
  console.log('-'.repeat(40));
  if (!BOOK_DIR) {
    console.log('⚠️  BOOK_DIR not set. Skipping parse POC.');
  } else {
    // Find the first PDF in the book directory
    const { books } = runScanner(BOOK_DIR, ['.pdf', '.epub', '.txt']);
    const pdf = books.find(b => b.format === 'pdf');
    const epub = books.find(b => b.format === 'epub');
    const txt = books.find(b => b.format === 'txt');

    if (pdf) {
      console.log(await verifyBookParsing(pdf.filePath));
    } else if (epub) {
      console.log(await verifyBookParsing(epub.filePath));
    } else if (txt) {
      console.log(await verifyBookParsing(txt.filePath));
    } else {
      console.log('⚠️  No supported book files found in directory.');
    }
  }

  // ---- POC-3: DeepSeek API Connection ----
  console.log('\n🤖 POC-3: DeepSeek API Connection');
  console.log('-'.repeat(40));
  if (!DEEPSEEK_KEY) {
    console.log('⚠️  DEEPSEEK_KEY not set. Skipping AI POC.');
    console.log('   Set with: export DEEPSEEK_KEY="sk-..."');
  } else {
    console.log(
      await verifyAIConnection({
        baseUrl: DEEPSEEK_URL,
        apiKey: DEEPSEEK_KEY,
        model: DEEPSEEK_MODEL,
      }),
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log('POC Verification Complete');
  console.log('='.repeat(60));
}

runAllPOCs().catch(err => {
  console.error('POC failed:', err);
  process.exit(1);
});

// ============================================================
// Test Helpers — shared utilities for unit tests
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tempDirs: string[] = [];

/**
 * Create a unique temporary directory for test isolation.
 * Auto-cleaned in afterAll via cleanupTempDirs().
 */
export function createTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-book-test-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a test file in the given directory.
 */
export function createTestFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Create a minimal valid EPUB file (EPUB is just a ZIP of XHTML).
 * Uses adm-zip to create the archive.
 */
export function createTestEpub(
  filePath: string,
  sections: Array<{ name: string; content: string }>,
): void {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();

  // Minimal EPUB structure
  zip.addFile(
    'mimetype',
    Buffer.from('application/epub+zip', 'utf-8'),
  );
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      'utf-8',
    ),
  );

  for (const section of sections) {
    zip.addFile(
      section.name,
      Buffer.from(
        `<html><head><title>${section.name}</title></head><body>${section.content}</body></html>`,
        'utf-8',
      ),
    );
  }

  zip.writeZip(filePath);
}

/**
 * Create a minimal test PDF file (text-based).
 * Since we can't easily create real PDFs in tests, create a simple
 * PDF file with extractable text content.
 */
export function createTestPdf(filePath: string, textContent: string): void {
  // Minimal valid PDF with text content
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (${textContent}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000262 00000 n
0000000356 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
419
%%EOF`;
  fs.writeFileSync(filePath, pdfContent, 'utf-8');
}

/**
 * Factory: create a mock fetch Response.
 */
export function mockFetchResponse(
  body: Record<string, unknown>,
  status: number = 200,
): { json: () => Promise<Record<string, unknown>>; ok: boolean; status: number; text: () => Promise<string> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Create a mock Obsidian App with populated vault and metadata cache.
 */
export function mockObsidianApp(): {
  App: typeof import('../__mocks__/obsidian').App;
  Vault: typeof import('../__mocks__/obsidian').Vault;
  MetadataCache: typeof import('../__mocks__/obsidian').MetadataCache;
} {
  const obsidian = require('../__mocks__/obsidian');
  return {
    App: obsidian.App,
    Vault: obsidian.Vault,
    MetadataCache: obsidian.MetadataCache,
  };
}

/**
 * Shared afterAll cleanup — call this in test files' afterAll.
 */
export function cleanupTempDirs(): void {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
  tempDirs = [];
}

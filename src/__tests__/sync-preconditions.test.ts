// ============================================================
// Unit Tests: Sync Precondition Checks
// Validates the behavior matrix:
//   - Manual scan always works (regardless of auto-sync toggle)
//   - Auto-sync only fires when all preconditions met
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { App } from 'obsidian';
import { ScanService, MemoryBookStore } from '../services/scan-service';
import { PluginSettings, DEFAULT_SETTINGS } from '../models';
import { NOOP_LOGGER } from '../logger';
import { createTempDir, createTestFile, cleanupTempDirs } from './helpers';

// ---- Precondition check logic (extracted for testability) ----
// Mirrors the logic in main.ts's canAutoSync()

interface PreconditionInput {
  autoSyncOnStartup: boolean;
  bookDirectory: string;
  notesFolder: string;
  notesFolderExists: boolean;
}

function checkPreconditions(input: PreconditionInput): { allowed: boolean; reason: string } {
  if (!input.autoSyncOnStartup) {
    return { allowed: false, reason: 'autoSyncOnStartup disabled' };
  }
  if (!input.bookDirectory || input.bookDirectory.trim() === '') {
    return { allowed: false, reason: 'bookDirectory not configured' };
  }
  if (!fs.existsSync(input.bookDirectory)) {
    return { allowed: false, reason: 'bookDirectory does not exist on disk' };
  }
  if (!input.notesFolderExists) {
    return { allowed: false, reason: 'notesFolder does not exist in vault' };
  }
  return { allowed: true, reason: 'all preconditions met' };
}

// ---- Helpers ----

function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// ---- Tests ----

describe('Sync Preconditions', () => {
  describe('checkPreconditions', () => {
    let bookDir: string;

    beforeEach(() => {
      bookDir = createTempDir('precond');
    });

    afterAll(() => {
      cleanupTempDirs();
    });

    // ---- Blocked scenarios ----

    it('should_block_when_autoSyncOnStartup_is_false', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: false,
        bookDirectory: bookDir,
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('autoSyncOnStartup disabled');
    });

    it('should_block_when_bookDirectory_is_empty_string', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: '',
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not configured');
    });

    it('should_block_when_bookDirectory_is_whitespace_only', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: '   ',
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not configured');
    });

    it('should_block_when_bookDirectory_does_not_exist', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: '/nonexistent/path/xyz',
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('should_block_when_notesFolder_does_not_exist', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: bookDir,
        notesFolder: '📚图书库',
        notesFolderExists: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('notesFolder');
    });

    // ---- Allowed scenario ----

    it('should_allow_when_all_preconditions_are_met', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: bookDir,
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('all preconditions met');
    });

    // ---- Partial combinations ----

    it('should_block_when_autoSync_is_on_but_bookDir_is_empty', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: '',
        notesFolder: '📚图书库',
        notesFolderExists: true,
      });
      expect(result.allowed).toBe(false);
    });

    it('should_block_when_autoSync_is_on_but_notesFolder_deleted', () => {
      const result = checkPreconditions({
        autoSyncOnStartup: true,
        bookDirectory: bookDir,
        notesFolder: '📚图书库',
        notesFolderExists: false,
      });
      expect(result.allowed).toBe(false);
    });
  });
});

// ---- Manual scan always works (regardless of auto-sync toggle) ----

describe('Manual scan availability', () => {
  let app: App;
  let bookDir: string;

  beforeEach(() => {
    app = new App();
    bookDir = createTempDir('manual');
    createTestFile(bookDir, 'manual_book.txt', 'Manual scan test content');
  });

  afterAll(() => {
    cleanupTempDirs();
  });

  it('should_allow_full_scan_when_autoSyncOnStartup_is_false', async () => {
    const store = new MemoryBookStore();
    const svc = new ScanService(
      app,
      makeSettings({ bookDirectory: bookDir, autoSyncOnStartup: false, autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      store,
    );

    const result = await svc.executeFullScan();
    expect(result.newBooks).toBe(1);
  });

  it('should_allow_full_scan_when_autoSyncOnStartup_is_true', async () => {
    const store = new MemoryBookStore();
    const svc = new ScanService(
      app,
      makeSettings({ bookDirectory: bookDir, autoSyncOnStartup: true, autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      store,
    );

    const result = await svc.executeFullScan();
    expect(result.newBooks).toBe(1);
  });

  it('should_allow_incremental_scan_when_autoSyncOnStartup_is_false', async () => {
    const store = new MemoryBookStore();
    const svc = new ScanService(
      app,
      makeSettings({ bookDirectory: bookDir, autoSyncOnStartup: false, autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      store,
    );

    const result = await svc.executeIncrementalScan();
    expect(result.newBooks).toBe(1);
  });

  it('should_block_full_scan_when_bookDirectory_is_empty', async () => {
    const store = new MemoryBookStore();
    const svc = new ScanService(
      app,
      makeSettings({ bookDirectory: '', autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      store,
    );

    await expect(svc.executeFullScan()).rejects.toThrow('not configured');
  });

  it('should_block_full_scan_when_bookDirectory_does_not_exist', async () => {
    const store = new MemoryBookStore();
    const svc = new ScanService(
      app,
      makeSettings({ bookDirectory: '/nonexistent/test/path', autoTagging: false }),
      undefined,
      NOOP_LOGGER,
      store,
    );

    await expect(svc.executeFullScan()).rejects.toThrow('does not exist');
  });
});

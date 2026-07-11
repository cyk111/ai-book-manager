// ============================================================
// File Watcher — real-time book directory monitoring via fs.watch
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Logger, NOOP_LOGGER } from '../logger';
import { detectFormat } from '../utils/path-utils';

// ---- Types ----

export interface WatchEvent {
  /** Absolute path to the new or changed file */
  filePath: string;
  /** Detected format (pdf/epub/txt) */
  format: string;
  /** File name including extension */
  fileName: string;
}

export type WatchCallback = (events: WatchEvent[]) => void;

export interface FileWatcherOptions {
  /** Directory to watch */
  directory: string;
  /** Supported file extensions (e.g. ['.pdf', '.epub', '.txt']) */
  formats: string[];
  /** Debounce window in ms (default 500) */
  debounceMs: number;
  /** Called when new files are detected */
  onNewFiles: WatchCallback;
  /** Logger instance */
  logger: Logger;
}

// ---- File Watcher ----

export class FileWatcher {
  private directory: string;
  private formats: string[];
  private debounceMs: number;
  private onNewFiles: WatchCallback;
  private log: Logger;

  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvents: Map<string, WatchEvent> = new Map();
  private knownFiles: Set<string> = new Set();
  private running = false;

  constructor(options: FileWatcherOptions) {
    this.directory = options.directory;
    this.formats = options.formats;
    this.debounceMs = options.debounceMs;
    this.onNewFiles = options.onNewFiles;
    this.log = options.logger;
  }

  // ---- Lifecycle ----

  /** Start watching the directory. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.running) {
      this.log.debug('FileWatcher already running', { directory: this.directory });
      return;
    }

    if (!this.directory || !fs.existsSync(this.directory)) {
      this.log.warn('Cannot start FileWatcher: directory not configured or missing', {
        directory: this.directory,
      });
      return;
    }

    // Seed known files from current directory state
    this.seedKnownFiles();

    try {
      this.watcher = fs.watch(
        this.directory,
        { recursive: true },
        (eventType, filename) => {
          this.handleEvent(eventType, filename);
        },
      );

      this.watcher.on('error', (err) => {
        this.log.warn('FileWatcher error', { error: String(err) });
      });

      this.watcher.on('close', () => {
        this.log.debug('FileWatcher closed', { directory: this.directory });
      });

      this.running = true;
      this.log.info('FileWatcher started', { directory: this.directory, formats: this.formats });
    } catch (err) {
      this.log.warn('Failed to start FileWatcher', {
        directory: this.directory,
        error: String(err),
      });
    }
  }

  /** Stop watching. Idempotent — safe to call multiple times. */
  stop(): void {
    if (!this.running) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.pendingEvents.clear();
    this.running = false;
    this.log.info('FileWatcher stopped');
  }

  /** Returns true if the watcher is currently active. */
  isRunning(): boolean {
    return this.running;
  }

  /** Update the watched directory. Restarts the watcher if already running. */
  setDirectory(newDir: string): void {
    if (newDir === this.directory) return;

    const wasRunning = this.running;
    this.stop();
    this.directory = newDir;
    this.knownFiles.clear();

    if (wasRunning) {
      this.start();
    }
  }

  /** Update supported formats. Restarts the watcher if already running. */
  setFormats(newFormats: string[]): void {
    this.formats = newFormats;
  }

  // ---- Internal ----

  private handleEvent(eventType: string, filename: string | null): void {
    if (!filename) return;

    const ext = path.extname(filename).toLowerCase();
    const fmt = detectFormat(ext);
    if (!fmt || !this.formats.includes(ext)) return;

    const filePath = path.join(this.directory, filename);

    // Only care about new or changed files
    if (eventType === 'rename') {
      // rename can mean either created or deleted
      if (!fs.existsSync(filePath)) {
        // File deleted — remove from known set
        this.knownFiles.delete(filePath);
        return;
      }
    }

    // Skip if we already know about this file
    if (this.knownFiles.has(filePath)) return;

    // Verify the file still exists and is readable
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;
    } catch {
      return; // File disappeared or is unreadable
    }

    const event: WatchEvent = {
      filePath,
      format: fmt,
      fileName: filename,
    };

    this.pendingEvents.set(filePath, event);
    this.knownFiles.add(filePath);

    // Debounce: batch events within the window
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    if (this.pendingEvents.size === 0) return;

    const events = Array.from(this.pendingEvents.values());
    this.pendingEvents.clear();

    this.log.info('FileWatcher detected new files', {
      count: events.length,
      files: events.map(e => e.fileName),
    });

    try {
      this.onNewFiles(events);
    } catch (err) {
      this.log.warn('FileWatcher callback error', { error: String(err) });
    }
  }

  private seedKnownFiles(): void {
    try {
      const entries = fs.readdirSync(this.directory, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (this.formats.includes(ext)) {
          // Build the full path: readdirSync with recursive gives just the name,
          // so we need to reconstruct. Actually, in Node 20+, recursive returns
          // the relative path from the parent dir.
          const fullPath = path.join(
            this.directory,
            (entry as fs.Dirent & { parentPath?: string }).parentPath
              ? path.relative(this.directory, path.join((entry as any).parentPath || '', entry.name))
              : entry.name,
          );
          this.knownFiles.add(fullPath);
        }
      }
      this.log.debug('FileWatcher seeded known files', { count: this.knownFiles.size });
    } catch (err) {
      this.log.warn('FileWatcher failed to seed known files', { error: String(err) });
    }
  }
}

// ---- Helpers ----

/** Default debounce interval for file watcher (ms) */
export const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Create a FileWatcher with sensible defaults.
 */
export function createFileWatcher(
  directory: string,
  formats: string[],
  onNewFiles: WatchCallback,
  logger: Logger = NOOP_LOGGER,
): FileWatcher {
  return new FileWatcher({
    directory,
    formats,
    debounceMs: DEFAULT_DEBOUNCE_MS,
    onNewFiles,
    logger,
  });
}

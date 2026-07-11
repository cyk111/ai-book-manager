// ============================================================
// Data Models — Core type definitions for the plugin
// ============================================================

/** Supported book file formats */
export type BookFormat = 'pdf' | 'epub' | 'txt';

/** Status of an AI task */
export type AITaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Type of AI operation */
export type AITaskType = 'tagging' | 'summary' | 'outline' | 'chapter-analysis';

/**
 * BookRecord — one record per scanned book file.
 * Persisted in plugin data.json under `books` key.
 */
export interface BookRecord {
  /** Unique ID derived from file path + hash (dedup key) */
  id: string;
  /** Original file name including extension */
  fileName: string;
  /** Absolute path to the book file on disk */
  filePath: string;
  /** File format */
  format: BookFormat;
  /** File size in bytes */
  fileSize: number;
  /** SHA256 hash of first 64KB (fast dedup, not whole file) */
  fileHash: string;
  /** File last-modified timestamp (ms epoch) */
  modifiedAt: number;
  /** Book title (extracted from metadata, or fallback to filename) */
  title: string;
  /** Author (if extractable) */
  author: string | null;
  /** AI-generated tags — written to note frontmatter */
  tags: string[];
  /** Vault-relative path to the generated Markdown note */
  notePath: string | null;
  /** When this record was first created (ms epoch) */
  createdAt: number;
  /** When this record was last updated (ms epoch) */
  updatedAt: number;
}

/**
 * AITask — one AI operation queued or executed.
 * Persisted in plugin data.json under `aiTasks` key.
 */
export interface AITask {
  /** Unique task ID */
  id: string;
  /** The book this task is for */
  bookId: string;
  /** What kind of AI operation */
  type: AITaskType;
  /** Current status */
  status: AITaskStatus;
  /** Error message if failed */
  error: string | null;
  /** Tokens consumed (from API response) */
  tokenUsed: number;
  /** When created (ms epoch) */
  createdAt: number;
  /** When completed (ms epoch) */
  completedAt: number | null;
}

/**
 * ScanCache — tracks incremental scan state.
 * Persisted in plugin data.json under `scanCache` key.
 */
export interface ScanCache {
  /** Last full scan timestamp (ms epoch) */
  lastFullScan: number | null;
  /** Total books found in last scan */
  totalBooksFound: number;
  /** Books added in last scan */
  booksAdded: number;
  /** Books skipped (already known) */
  booksSkipped: number;
  /** Books failed to parse */
  booksFailed: number;
}

/**
 * PluginSettings — user configuration.
 * Stored in Obsidian's settings system (data.json under settings).
 */
export interface PluginSettings {
  /** Absolute path to the book directory */
  bookDirectory: string;
  /** File extensions to include, with dot: ['.pdf', '.epub', '.txt'] */
  supportedFormats: string[];
  /** DeepSeek API key */
  deepseekApiKey: string;
  /** DeepSeek API base URL */
  deepseekBaseUrl: string;
  /** DeepSeek model name */
  deepseekModel: string;
  /** Automatically tag books after scanning */
  autoTagging: boolean;
  /** Vault folder for generated notes */
  notesFolder: string;
  /** Max pages to extract for AI classification (default 3) */
  maxScanPages: number;
  /** Max concurrent AI requests */
  maxConcurrency: number;
  /** Automatically run incremental scan on plugin startup */
  autoSyncOnStartup: boolean;
  /** Watch book directory for changes in real-time (fs.watch) */
  watchBookDirectory: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  bookDirectory: '',
  supportedFormats: ['.pdf', '.epub', '.txt'],
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com/v1',
  deepseekModel: 'deepseek-chat',
  autoTagging: false,
  notesFolder: '📚图书库',
  maxScanPages: 3,
  maxConcurrency: 1,
  autoSyncOnStartup: false,
  watchBookDirectory: false,
};

/**
 * AITagResult — expected shape of DeepSeek structured output for tagging.
 */
export interface AITagResult {
  title: string;
  author: string | null;
  tags: string[];
  category: string | null;
}

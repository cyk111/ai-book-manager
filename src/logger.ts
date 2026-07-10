// ============================================================
// Structured Logger — JSON logs with correlation IDs
// ============================================================

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  error: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Create a logger scoped to a correlation ID.
 * In Obsidian runtime, logs to console as JSON lines.
 * In tests, console output is capturable.
 */
export function createLogger(correlationId: string): Logger {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId,
      data,
    };

    const json = JSON.stringify(entry);

    switch (level) {
      case 'ERROR':
        console.error(json);
        break;
      case 'WARN':
        console.warn(json);
        break;
      case 'INFO':
        console.info(json);
        break;
      case 'DEBUG':
        console.debug(json);
        break;
    }
  }

  return {
    error: (msg, data) => log('ERROR', msg, data),
    warn: (msg, data) => log('WARN', msg, data),
    info: (msg, data) => log('INFO', msg, data),
    debug: (msg, data) => log('DEBUG', msg, data),
  };
}

/** Logger that discards all output (for tests) */
export const NOOP_LOGGER: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

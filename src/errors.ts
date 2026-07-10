// ============================================================
// Typed Error Hierarchy — every error in the plugin extends AppError
// ============================================================

/** Prefix for all error codes */
const PREFIX = 'AIBM';

/**
 * Base application error with correlation ID for tracing.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly correlationId: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    correlationId: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = `${PREFIX}_${code}`;
    this.correlationId = correlationId;
    this.details = details;
  }

  toLogEntry(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}

// ---- Domain-specific errors ----

export class ScanError extends AppError {
  constructor(message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message, 'SCAN_ERROR', correlationId, details);
    this.name = 'ScanError';
  }
}

export class ParseError extends AppError {
  constructor(message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message, 'PARSE_ERROR', correlationId, details);
    this.name = 'ParseError';
  }
}

export class AIError extends AppError {
  constructor(message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message, 'AI_ERROR', correlationId, details);
    this.name = 'AIError';
  }
}

export class NetworkError extends AppError {
  constructor(message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', correlationId, details);
    this.name = 'NetworkError';
  }
}

export class QueueError extends AppError {
  constructor(message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message, 'QUEUE_ERROR', correlationId, details);
    this.name = 'QueueError';
  }
}

/**
 * Generate a short unique correlation ID.
 */
export function generateCorrelationId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

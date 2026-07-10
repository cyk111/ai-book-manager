// ============================================================
// Token Estimator — rough token count for budget tracking
// ============================================================
//
// Chinese chars ~ 1 token each, English ~ 0.25 tokens each.
// This is for budget estimation, not exact accounting.

export const TOKEN_BUDGET = {
  /** Max input chars for tagging prompt */
  TAGGING_MAX_INPUT: 500,
  /** Max preview chars in tagging prompt */
  TAGGING_MAX_PREVIEW: 300,
  /** Max output tokens for tagging */
  TAGGING_MAX_OUTPUT: 200,
  /** Max input chars for summary generation */
  SUMMARY_MAX_INPUT: 3000,
  /** Max output tokens for summary */
  SUMMARY_MAX_OUTPUT: 400,
  /** Max input chars for outline */
  OUTLINE_MAX_INPUT: 5000,
  /** Max output tokens for outline */
  OUTLINE_MAX_OUTPUT: 800,
  /** Max input chars for chapter analysis */
  CHAPTER_MAX_INPUT: 10000,
  /** Max output tokens for chapter analysis */
  CHAPTER_MAX_OUTPUT: 1200,
} as const;

/**
 * Estimate token count from text length.
 * Chinese: ~1 token per char (CJK Unified Ideographs range)
 * Other: ~0.25 tokens per char (Latin alphabet typical ratio)
 */
export function estimateTokens(text: string): number {
  let chinese = 0;
  let other = 0;

  for (const ch of text) {
    // CJK Unified Ideographs + Extension A (common Chinese)
    if (/[一-鿿㐀-䶿]/.test(ch)) {
      chinese++;
    } else {
      other++;
    }
  }

  return Math.ceil(chinese + other / 4);
}

/**
 * Estimate cost in CNY based on DeepSeek pricing (~1 RMB per 1M tokens).
 */
export function estimateCost(tokenCount: number): number {
  return (tokenCount / 1_000_000) * 1.0;
}

/**
 * Format cost for display.
 */
export function formatCost(tokenCount: number): string {
  return `~${estimateCost(tokenCount).toFixed(6)} CNY`;
}

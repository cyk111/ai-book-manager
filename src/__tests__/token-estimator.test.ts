import { estimateTokens, estimateCost, formatCost, TOKEN_BUDGET } from '../utils/token-estimator';

describe('estimateTokens', () => {
  it('should_count_chinese_chars_as_1_token_each', () => {
    const result = estimateTokens('人工智能');
    expect(result).toBe(4); // 4 Chinese chars = 4 tokens
  });

  it('should_count_english_chars_as_quarter_token_each', () => {
    const result = estimateTokens('hello');
    expect(result).toBe(2); // 5 English chars / 4 = 1.25 → ceil = 2
  });

  it('should_handle_mixed_chinese_and_english', () => {
    const result = estimateTokens('AI人工智能');
    // 2 eng chars (2/4=0.5) + 4 chinese chars (4) = 4.5 → ceil = 5
    expect(result).toBe(5);
  });

  it('should_return_0_for_empty_string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should_estimate_large_text_proportionally', () => {
    const chinese = '一'.repeat(1000);
    expect(estimateTokens(chinese)).toBe(1000);

    const english = 'a'.repeat(1000);
    expect(estimateTokens(english)).toBe(250); // 1000/4
  });
});

describe('estimateCost', () => {
  it('should_calculate_cost_at_1_rmb_per_million_tokens', () => {
    expect(estimateCost(1_000_000)).toBeCloseTo(1.0);
  });

  it('should_calculate_cost_for_small_token_counts', () => {
    expect(estimateCost(200)).toBeCloseTo(0.0002);
  });

  it('should_return_0_for_0_tokens', () => {
    expect(estimateCost(0)).toBe(0);
  });
});

describe('formatCost', () => {
  it('should_format_cost_with_currency_symbol', () => {
    const result = formatCost(200);
    expect(result).toContain('CNY');
    expect(result).toContain('0.000200');
  });
});

describe('TOKEN_BUDGET', () => {
  it('should_define_all_budget_constants', () => {
    expect(TOKEN_BUDGET.TAGGING_MAX_INPUT).toBe(500);
    expect(TOKEN_BUDGET.TAGGING_MAX_PREVIEW).toBe(300);
    expect(TOKEN_BUDGET.TAGGING_MAX_OUTPUT).toBe(200);
    expect(TOKEN_BUDGET.SUMMARY_MAX_INPUT).toBe(3000);
    expect(TOKEN_BUDGET.SUMMARY_MAX_OUTPUT).toBe(400);
    expect(TOKEN_BUDGET.OUTLINE_MAX_INPUT).toBe(5000);
    expect(TOKEN_BUDGET.OUTLINE_MAX_OUTPUT).toBe(800);
    expect(TOKEN_BUDGET.CHAPTER_MAX_INPUT).toBe(10000);
    expect(TOKEN_BUDGET.CHAPTER_MAX_OUTPUT).toBe(1200);
  });
});

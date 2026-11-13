/** The size a response aims for by default, in estimated tokens. */
export const TARGET_TOKENS = 2_000;
/** The most a response may use, when the caller narrowed the request or asked for more. */
export const MAX_TOKENS = 6_000;

/** Drops null and undefined values from objects and arrays, recursively. */
export function dropNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined).map((item) => dropNulls(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && item !== undefined) out[key] = dropNulls(item);
    }
    return out as T;
  }
  return value;
}

export function serialize(value: unknown): string {
  return JSON.stringify(dropNulls(value));
}

/** Estimates tokens as characters over four, of the compact JSON the client receives. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(serialize(value).length / 4);
}

/** Room kept free for the truncated, hint, note and warning fields added after trimming. */
export const ENVELOPE_TOKENS = 150;

/**
 * The largest count in [0, total] whose output fits the budget, less ENVELOPE_TOKENS.
 * `build` must grow with the count, which holds for every list the tools trim.
 */
export function fitCount(total: number, tokens: number, build: (count: number) => unknown): number {
  const budget = tokens - ENVELOPE_TOKENS;
  if (estimateTokens(build(total)) <= budget) return total;
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(build(mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  return low;
}

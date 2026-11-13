import { describe, expect, it } from 'vitest';

import { BudgetExceededError, CallContext, parseAllowance, REQUEST_BUDGET } from '../src/context.js';
import { isWellFormedApiKey } from '../src/key.js';
import { dropNulls, estimateTokens, fitCount } from '../src/output.js';
import { displayName, rankTeams } from '../src/teams.js';
import { fold } from '../src/text.js';
import { addDays, formatClock, localParts, resolveDate } from '../src/time.js';
import { TEST_KEY } from './helpers/stub.js';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

describe('isWellFormedApiKey', () => {
  const issued = `sporty_${b64url(crypto.getRandomValues(new Uint8Array(12)))}.${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;

  it.each([
    ['a key issued the way internal/accounts issues them', issued, true],
    ['the test key', TEST_KEY, true],
    ['an empty string', '', false],
    ['a key without the sporty_ prefix', TEST_KEY.replace('sporty_', 'statpad_'), false],
    ['a key with a short secret', TEST_KEY.slice(0, -1), false],
    ['a key with a non-canonical last character', TEST_KEY.slice(0, -1) + 'x', false],
    ['a key with a space in it', TEST_KEY.replace('Ab', 'A '), false],
    ['a key with a trailing newline', TEST_KEY + '\n', false],
    ['a bearer header', `Bearer ${TEST_KEY}`, false],
  ])('%s', (_name, key, expected) => {
    expect(isWellFormedApiKey(key)).toBe(expected);
  });
});

describe('time', () => {
  it('resolves today, yesterday and tomorrow in the time zone', () => {
    const now = new Date('2026-11-10T03:00:00Z');
    expect(resolveDate('today', now, 'America/New_York')).toBe('2026-11-09');
    expect(resolveDate('today', now, 'Europe/London')).toBe('2026-11-10');
    expect(resolveDate('tomorrow', now, 'America/New_York')).toBe('2026-11-10');
    expect(resolveDate('yesterday', now, 'Asia/Tokyo')).toBe('2026-11-09');
    expect(resolveDate('2026-01-02', now, 'UTC')).toBe('2026-01-02');
  });

  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formats local time on a 24-hour clock', () => {
    expect(localParts(new Date('2026-11-10T05:00:00Z'), 'America/New_York')).toEqual({ date: '2026-11-10', time: '00:00' });
  });

  it('formats a game clock', () => {
    expect(formatClock(422)).toBe('7:02');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(900)).toBe('15:00');
  });
});

describe('fold and team matching', () => {
  it('ignores case and accents', () => {
    expect(fold('Victor Lindelöf')).toBe('victor lindelof');
    expect(fold('Martin Ødegaard')).toBe('martin odegaard');
    expect(fold('  João   Gomes ')).toBe('joao gomes');
  });

  const teams = [
    { alias: 'BUF', market: 'Buffalo', name: 'Bills' },
    { alias: 'MIN', market: 'Minnesota', name: 'Vikings' },
    { alias: 'ATM', market: 'Atlético Madrid', name: 'Atlético Madrid' },
    { alias: 'MNC', market: 'Manchester City', name: 'Manchester City' },
    { alias: 'MAN', market: 'Manchester United', name: 'Manchester United' },
  ];

  it.each([
    ['an abbreviation', 'min', ['MIN']],
    ['a nickname', 'Bills', ['BUF']],
    ['market and name', 'buffalo bills', ['BUF']],
    ['an accent-free spelling', 'atletico', ['ATM']],
    ['a shared prefix', 'manchester', ['MNC', 'MAN']],
    ['words in any order', 'united manchester', ['MAN']],
    ['nothing', 'zzz', []],
  ])('matches %s', (_name, query, expected) => {
    expect(rankTeams(teams, query).map((team) => team.alias)).toEqual(expected);
  });

  it('shows the market once when it repeats the name', () => {
    expect(displayName({ market: 'Buffalo', name: 'Bills' })).toBe('Buffalo Bills');
    expect(displayName({ market: 'Aston Villa', name: 'Aston Villa' })).toBe('Aston Villa');
  });
});

describe('output', () => {
  it('drops nulls but keeps empty lists, zeros and false', () => {
    expect(dropNulls({ a: null, b: 0, c: false, d: [], e: { f: null, g: [null, 1] } })).toEqual({ b: 0, c: false, d: [], e: { g: [1] } });
  });

  it('finds the largest count that fits', () => {
    const build = (count: number) => ({ items: Array.from({ length: count }, () => 'x'.repeat(40)) });
    const count = fitCount(1000, 1000, build);
    expect(estimateTokens(build(count))).toBeLessThanOrEqual(1000 - 150);
    expect(estimateTokens(build(count + 1))).toBeGreaterThan(1000 - 150);
  });
});

describe('parseAllowance', () => {
  it('reads the allowance policy', () => {
    expect(parseAllowance('"allowance";r=499120;t=1723456', '"allowance";q=500000;w=2592000')).toEqual({
      remaining: 499120,
      limit: 500000,
      resetSeconds: 1723456,
    });
  });

  it('ignores other policies and unknown parameters', () => {
    expect(parseAllowance('"burst";r=3, "allowance";x=1;r=12;t=60', '"allowance";q=100;w=60;z=9')).toEqual({ remaining: 12, limit: 100, resetSeconds: 60 });
  });

  it('returns nothing without the header', () => {
    expect(parseAllowance(null, null)).toBeUndefined();
    expect(parseAllowance('"other";r=1', null)).toBeUndefined();
  });
});

describe('the request budget', () => {
  it('lets a call send three requests and fails the fourth', async () => {
    const ctx = new CallContext({ apiKey: TEST_KEY, userAgent: 'test' }, { now: () => new Date() });
    for (let i = 0; i < REQUEST_BUDGET; i++) await ctx.request(async () => i);
    await expect(ctx.request(async () => 'one too many')).rejects.toBeInstanceOf(BudgetExceededError);
    expect(ctx.requests).toBe(REQUEST_BUDGET + 1);
  });
});

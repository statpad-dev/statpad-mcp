import { StatpadError } from '@statpad/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { describeError } from '../src/errors.js';
import { connect, type Harness, type HarnessOptions } from './helpers/harness.js';
import { NFL_GAME, problem, TEST_KEY } from './helpers/stub.js';

let h: Harness | undefined;
async function open(options: HarnessOptions = {}): Promise<Harness> {
  h = await connect(options);
  return h;
}
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Answers every request with the same problem. */
function always(response: () => Response): HarnessOptions {
  return { override: () => response() };
}

describe('error mapping', () => {
  it('maps unauthorized to a check of STATPAD_API_KEY', async () => {
    const result = await (await open(always(() => problem(401, 'unauthorized', 'The API key is unknown.')))).call('list_leagues');
    expect(result.isError).toBe(true);
    expect(result.json).toMatchObject({ error: 'unauthorized', request_id: 'req_test_0001' });
    expect(result.json.message).toContain('STATPAD_API_KEY');
  });

  it('maps forbidden to the plan or an unknown alias, and points at list_leagues', async () => {
    const result = await (await open()).call('find_teams', { league: 'nba' });
    expect(result.json).toMatchObject({ error: 'forbidden', request_id: 'req_test_0001' });
    expect(result.json.message).toContain('"nba"');
    expect(result.json.message).toContain("isn't a league Statpad serves");
    expect(result.json.message).toContain('list_leagues');
  });

  it('maps not_found with the API detail', async () => {
    const result = await (await open()).call('get_game', { league: 'nfl', game_id: '01a1cca4-0000-7000-8000-000000000000' });
    expect(result.json).toMatchObject({ error: 'not_found', detail: expect.stringContaining('No game') });
    expect(result.json.message).toContain('find_games');
  });

  it('maps rate_limited with retry_after and asks to slow down, after one retry', async () => {
    const result = await (
      await open(always(() => problem(429, 'rate_limited', 'Too many requests.', {}, { 'Retry-After': '1' })))
    ).call('list_leagues');
    expect(result.json).toMatchObject({ error: 'rate_limited', retry_after: 1, request_id: 'req_test_0001' });
    expect(result.json.message).toContain('slow');
    expect(result.requests).toHaveLength(2);
  });

  it('maps a Retry-After longer than the call timeout to rate_limited, not a timeout', async () => {
    const result = await (
      await open({ timeoutMs: 300, ...always(() => problem(429, 'rate_limited', 'Too many requests.', {}, { 'Retry-After': '30' })) })
    ).call('list_leagues');
    expect(result.json).toMatchObject({ error: 'rate_limited', retry_after: 30 });
    expect(result.requests).toHaveLength(1);
  });

  it('maps quota_exhausted with resets_at, says not to retry, and does not retry', async () => {
    const resetsAt = '2026-12-01T00:00:00Z';
    const result = await (
      await open(always(() => problem(429, 'quota_exhausted', 'Allowance used.', { resets_at: resetsAt }, { 'Retry-After': '1555200' })))
    ).call('list_leagues');
    expect(result.json).toMatchObject({ error: 'quota_exhausted', resets_at: resetsAt });
    expect(result.json.message).toContain("Don't retry");
    expect(result.requests).toHaveLength(1);
  });

  it.each([
    ['internal', 500],
    ['unavailable', 503],
  ])('maps %s as transient', async (code, status) => {
    const result = await (await open(always(() => problem(status, code, 'Try later.', {}, { 'Retry-After': '0' })))).call('list_leagues');
    expect(result.json).toMatchObject({ error: code, request_id: 'req_test_0001' });
    expect(result.json.message).toContain('temporary');
    expect(result.requests).toHaveLength(2);
  });

  it('passes the bad_request detail through', async () => {
    const result = await (await open(always(() => problem(400, 'bad_request', 'limit must be at most 500.')))).call('list_leagues');
    expect(result.json).toMatchObject({ error: 'bad_request', detail: 'limit must be at most 500.' });
    expect(result.json.message).toContain('limit must be at most 500.');
  });

  it('maps an after_seq beyond the stream head to bad_request', async () => {
    const result = await (await open()).call('get_plays', { league: 'nfl', game_id: NFL_GAME, after_seq: 99_999 });
    expect(result.json).toMatchObject({ error: 'bad_request' });
  });

  it('maps resync_required, which get_plays handles itself, if it ever escapes', () => {
    const response = new Response(null, { status: 410 });
    const error = new StatpadError(response, { code: 'resync_required', title: 'Resync required', min_seq: 1200, request_id: 'r1' });
    expect(describeError(error, undefined)).toMatchObject({ error: 'resync_required', min_seq: 1200, request_id: 'r1' });
  });

  it('maps a network failure as transient', async () => {
    const result = await (
      await open({
        override: () => {
          throw new TypeError('fetch failed');
        },
      })
    ).call('list_leagues');
    expect(result.json).toMatchObject({ error: 'unavailable', detail: 'fetch failed' });
  });

  it('maps a call that runs out of time', async () => {
    const result = await (
      await open({ timeoutMs: 200, override: (_url, request) => new Promise<Response>((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))) })
    ).call('list_leagues');
    expect(result.json.error).toBe('timeout');
  });

  it('never puts the key in an error, even when the API echoes it', async () => {
    const result = await (await open(always(() => problem(400, 'bad_request', `bad key ${TEST_KEY}`)))).call('list_leagues');
    expect(result.text).not.toContain(TEST_KEY);
    expect(result.text).toContain('[redacted]');
  });
});

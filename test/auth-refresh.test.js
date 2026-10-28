'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_FRESH_MS,
  DEFAULT_REFRESH_INTERVAL_MS,
  isAuthFresh,
  shouldRunBackgroundCheck,
  createCoalescedCheck
} = require('../public/lib/auth-refresh.js');

test('refresh cadence stays under the freshness window', () => {
  // The whole point of the background timer: re-confirm before the freshness
  // window lapses, so Record almost never waits on its own round trip.
  assert.ok(DEFAULT_REFRESH_INTERVAL_MS < DEFAULT_FRESH_MS);
});

test('isAuthFresh: never-confirmed and past-window are not fresh', () => {
  assert.equal(isAuthFresh(0, 100000), false);
  assert.equal(isAuthFresh(50000, 50000 + DEFAULT_FRESH_MS - 1), true);
  assert.equal(isAuthFresh(50000, 50000 + DEFAULT_FRESH_MS), false);
  assert.equal(isAuthFresh(50000, 50000 + DEFAULT_FRESH_MS + 1), false);
});

test('isAuthFresh: honours a custom window', () => {
  assert.equal(isAuthFresh(1000, 1000 + 999, 1000), true);
  assert.equal(isAuthFresh(1000, 1000 + 1000, 1000), false);
});

test('shouldRunBackgroundCheck: only visible + idle + not already checking', () => {
  assert.equal(shouldRunBackgroundCheck({ visible: true, busy: false, inflight: false }), true);
  assert.equal(shouldRunBackgroundCheck({ visible: false, busy: false, inflight: false }), false);
  assert.equal(shouldRunBackgroundCheck({ visible: true, busy: true, inflight: false }), false);
  assert.equal(shouldRunBackgroundCheck({ visible: true, busy: false, inflight: true }), false);
  assert.equal(shouldRunBackgroundCheck({}), false);
  assert.equal(shouldRunBackgroundCheck(), false);
});

test('createCoalescedCheck: concurrent callers share one request', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const run = createCoalescedCheck(async () => { calls++; await gate; return 'ok'; });

  const a = run();
  const b = run();
  const c = run();
  assert.equal(run.pending(), true);
  release();
  assert.deepEqual(await Promise.all([a, b, c]), ['ok', 'ok', 'ok']);
  assert.equal(calls, 1);
  assert.equal(run.pending(), false);

  // After settling, the next call starts a fresh check.
  const d = run();
  assert.equal(run.pending(), true);
  await d;
  assert.equal(calls, 2);
});

test('createCoalescedCheck: a failure clears the in-flight slot for a retry', async () => {
  let calls = 0;
  const run = createCoalescedCheck(async () => {
    calls++;
    if (calls === 1) throw new Error('network down');
    return 'recovered';
  });
  await assert.rejects(run(), /network down/);
  assert.equal(run.pending(), false);
  assert.equal(await run(), 'recovered');
  assert.equal(calls, 2);
});

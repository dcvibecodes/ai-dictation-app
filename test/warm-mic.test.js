'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WarmMic = require('../public/lib/warm-mic.js');

test('warm mic: 15 minute window and countdown formatting', () => {
  assert.equal(WarmMic.WARM_MIC_MS, 15 * 60 * 1000);
  assert.equal(WarmMic.formatRemaining(15 * 60 * 1000), '15m');
  assert.equal(WarmMic.formatRemaining(14 * 60 * 1000 + 1000), '15m');
  assert.equal(WarmMic.formatRemaining(60 * 1000), '1m');
  assert.equal(WarmMic.formatRemaining(59 * 1000), '59s');
  assert.equal(WarmMic.formatRemaining(0), '0s');
  assert.equal(WarmMic.formatRemaining(-500), '0s');
});

test('warm mic: remaining time clamps at zero and detects expiry', () => {
  assert.equal(WarmMic.remainingMs(1000, 0), 1000);
  assert.equal(WarmMic.remainingMs(1000, 2000), 0);
  assert.equal(WarmMic.isExpired(1000, 999), false);
  assert.equal(WarmMic.isExpired(1000, 1000), true);
  assert.equal(WarmMic.isExpired('nope', 1000), true);
});

test('warm mic: the idle deadline never fires during a take', () => {
  const expiresAt = 60 * 1000;
  const now = 2 * 60 * 1000;
  assert.equal(WarmMic.shouldExpire({ expiresAt, now }), true);
  assert.equal(WarmMic.shouldExpire({ expiresAt, now, isRecording: true }), false);
  assert.equal(WarmMic.shouldExpire({ expiresAt, now, isStarting: true }), false);
  assert.equal(WarmMic.shouldExpire({ expiresAt, now, streamStopping: true }), false);
  assert.equal(WarmMic.shouldExpire({ expiresAt: now + 60 * 1000, now }), false);
});

test('warm mic: allowed durations are 15, 30 and 60 minutes', () => {
  assert.deepEqual(WarmMic.ALLOWED_MINUTES, [15, 30, 60]);
  assert.equal(WarmMic.normalizeMinutes(15), 15);
  assert.equal(WarmMic.normalizeMinutes('30'), 30);
  assert.equal(WarmMic.normalizeMinutes(60), 60);
  assert.equal(WarmMic.normalizeMinutes(45), 15);
  assert.equal(WarmMic.normalizeMinutes('nope'), 15);
  assert.equal(WarmMic.durationMs(15), 15 * 60 * 1000);
  assert.equal(WarmMic.durationMs(30), 30 * 60 * 1000);
  assert.equal(WarmMic.durationMs(60), 60 * 60 * 1000);
});

test('warm mic: 60 minutes formats as 1h', () => {
  assert.equal(WarmMic.formatRemaining(60 * 60 * 1000), '1h');
  assert.equal(WarmMic.formatRemaining(59 * 60 * 1000), '59m');
  assert.equal(WarmMic.formatRemaining(30 * 60 * 1000), '30m');
});

test('warm mic: duration labels match the selected window', () => {
  assert.equal(WarmMic.durationLabel(15), '15 minutes');
  assert.equal(WarmMic.durationLabel(30), '30 minutes');
  assert.equal(WarmMic.durationLabel(60), '1 hour');
  assert.equal(WarmMic.durationLabel(45), '15 minutes');
  assert.equal(WarmMic.durationLabel('nope'), '15 minutes');
});

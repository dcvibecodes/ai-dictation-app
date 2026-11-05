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

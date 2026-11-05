// Pure helpers for the timed warm-mic state. Kept separate so the Node test
// suite can cover the 15-minute countdown without a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WarmMicLib = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WARM_MIC_MS = 15 * 60 * 1000;
  const ALLOWED_MINUTES = [15, 30, 60];
  const DEFAULT_MINUTES = 15;

  function normalizeMinutes(value) {
    const minutes = Number(value);
    return ALLOWED_MINUTES.includes(minutes) ? minutes : DEFAULT_MINUTES;
  }

  function durationMs(minutes) {
    return normalizeMinutes(minutes) * 60 * 1000;
  }

  function remainingMs(expiresAt, now = Date.now()) {
    const value = Number(expiresAt);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value - now);
  }

  function formatRemaining(ms) {
    const value = Math.max(0, Number(ms) || 0);
    if (value < 60 * 1000) return `${Math.ceil(value / 1000)}s`;
    if (value >= 60 * 60 * 1000) return `${Math.ceil(value / (60 * 60 * 1000))}h`;
    return `${Math.ceil(value / 60000)}m`;
  }

  function isExpired(expiresAt, now = Date.now()) {
    const value = Number(expiresAt);
    return !Number.isFinite(value) || value <= now;
  }

  // The idle deadline must never fire while a take is starting, running or
  // finalizing. This is the pure decision used by the ticker.
  function shouldExpire({ expiresAt, now = Date.now(), isRecording = false, isStarting = false, streamStopping = false }) {
    if (isRecording || isStarting || streamStopping) return false;
    return isExpired(expiresAt, now);
  }

  return {
    WARM_MIC_MS,
    ALLOWED_MINUTES,
    DEFAULT_MINUTES,
    normalizeMinutes,
    durationMs,
    remainingMs,
    formatRemaining,
    isExpired,
    shouldExpire
  };
});

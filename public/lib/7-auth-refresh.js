// Background login refresh: pure decision logic for the "keep the session warm"
// feature, separated so the Node tests can cover it without a browser.
//
// The app re-confirms the session on a timer while the page is visible and
// idle, so pressing Record almost always finds a fresh OK and skips its own
// network round trip. This module owns the three decisions:
//   1. isAuthFresh              — is the last confirmed OK still trustworthy?
//   2. shouldRunBackgroundCheck — may the background timer fire right now?
//   3. createCoalescedCheck     — all callers share one in-flight request.
//
// The same file is loaded in the browser (window.AuthRefreshLib) and used by
// the Node tests (module.exports).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuthRefreshLib = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_FRESH_MS = 60000;            // Record skips its own check if the last OK is newer
  const DEFAULT_REFRESH_INTERVAL_MS = 45000; // background cadence; must stay under FRESH_MS

  // Is a login confirmed at lastAuthOkAt still fresh at `now`?
  // lastAuthOkAt of 0 (never confirmed, or reset after a 401) is never fresh.
  function isAuthFresh(lastAuthOkAt, now, freshMs) {
    if (!lastAuthOkAt) return false;
    const window_ = typeof freshMs === 'number' ? freshMs : DEFAULT_FRESH_MS;
    return (now - lastAuthOkAt) < window_;
  }

  // May a background timer tick fire a check right now?
  //   visible  — the tab must be on screen (a backgrounded phone PWA must not poll)
  //   busy     — recording, starting, draining or processing: chunk uploads already
  //              detect expiry mid-take, and a check must never delay or race a take
  //   inflight — a check is already running (a Record click landed on a tick)
  function shouldRunBackgroundCheck(opts) {
    const o = opts || {};
    return !!o.visible && !o.busy && !o.inflight;
  }

  // Wrap an async check so concurrent callers join the same in-flight promise.
  // The next call after settle (success OR failure) starts a fresh check.
  function createCoalescedCheck(checkFn) {
    let inflight = null;
    const run = function () {
      if (inflight) return inflight;
      inflight = Promise.resolve()
        .then(checkFn)
        .finally(() => { inflight = null; });
      return inflight;
    };
    run.pending = () => !!inflight;
    return run;
  }

  return {
    DEFAULT_FRESH_MS,
    DEFAULT_REFRESH_INTERVAL_MS,
    isAuthFresh,
    shouldRunBackgroundCheck,
    createCoalescedCheck
  };
});

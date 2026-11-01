// Small pure helpers for the Settings profile UI. Kept separate so the Node
// test suite can cover them without a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProfilesUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function monogram(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? words[0][0].toUpperCase() : '?';
  }

  function descriptor(provider) {
    if (!provider) return '';
    if (provider.id === 'custom') return 'OpenAI-compatible URL';
    if (provider.protocol === 'cartesia') return 'Streaming · ink-2';
    if (provider.tier >= 1) return 'Built-in adapter';
    return 'Key + model only';
  }

  function formatLatency(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    return n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms';
  }

  function maskKey(key) {
    if (!key) return '';
    const s = String(key);
    return '••••' + s.slice(-4);
  }

  return { initials, monogram, descriptor, formatLatency, maskKey };
});

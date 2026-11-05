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
    if (provider.stream) return 'Live + batch';
    if (provider.protocol === 'cartesia') return 'Live only';
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

  // Model labels: always show the official display name next to the exact API
  // ID, plus the cost/language note when the provider supplies one.
  function modelMeta(labels, modelId) {
    if (!labels || !modelId) return null;
    const meta = labels[modelId];
    return meta && typeof meta === 'object' ? meta : null;
  }

  function modelLabel(modelId, meta) {
    if (!modelId) return '';
    return meta && meta.displayName ? `${meta.displayName} (${modelId})` : String(modelId);
  }

  function modelSubLabel(meta) {
    if (!meta) return '';
    return [meta.languageNote, meta.costLabel].filter(Boolean).join(' ');
  }

  return { initials, monogram, descriptor, formatLatency, maskKey, modelMeta, modelLabel, modelSubLabel };
});

'use strict';

// SameSite=strict is one layer, not proof. Sensitive mutations additionally
// require the Origin (or Referer) host to match the app's own host.
//
// Non-browser clients (curl, the test suite) send neither header; those are
// allowed, because they cannot be tricked into carrying a victim's cookie.
function hostOf(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeAllowedOrigins(list) {
  if (!list) return [];
  const items = Array.isArray(list) ? list : String(list).split(',');
  return items.map(v => String(v).trim()).filter(Boolean).map(v => {
    const host = hostOf(v) || hostOf('https://' + v);
    return host || v.toLowerCase();
  });
}

/**
 * @param {{ origin?: string, referer?: string, host?: string,
 *           forwardedHost?: string, allowedOrigins?: string[] }} req
 * @returns {boolean}
 */
function isSameOriginRequest(req = {}) {
  const source = req.origin || req.referer;
  if (!source) return true; // non-browser client
  const sourceHost = hostOf(source);
  if (!sourceHost) return false;
  const allowed = normalizeAllowedOrigins(req.allowedOrigins);
  if (allowed.length && allowed.includes(sourceHost)) return true;
  // Reverse proxies often rewrite Host but preserve X-Forwarded-Host.
  const hosts = [req.host, req.forwardedHost]
    .filter(Boolean)
    .map(h => String(h).split(',')[0].trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(sourceHost);
}

module.exports = { hostOf, normalizeAllowedOrigins, isSameOriginRequest };

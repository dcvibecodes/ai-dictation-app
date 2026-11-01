require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const cookieParser = require('cookie-parser');
const OpenAI  = require('openai');
const { toFile } = require('openai');
const { normalizeGlossary } = require('./public/lib/corrections.js');
const rateLimit = require('express-rate-limit');
const { WebSocketServer, WebSocket } = require('ws');
const streamLib = require('./lib/stream');

const { createSessionToken, verifySessionToken, DEFAULT_MAX_AGE_MS } = require('./lib/sessions');
const { isSameOriginRequest } = require('./lib/csrf');
const { validateNewPassword, validateUsername, normalizeUsername } = require('./lib/passwords');
const {
  writeFileAtomic,
  readOwnerRecord,
  writeOwnerRecord,
  migrateOwnerRecord
} = require('./lib/owner');
const providers = require('./lib/providers');
const adapters = require('./lib/adapters');
const APP_VERSION = require('./package.json').version;
const OPENCODE_SESSION_ID = crypto.randomUUID();
const { extensionForMime } = require('./lib/media');

const app    = express();
app.set('trust proxy', 1); // Behind nginx — use X-Forwarded-For so rate limiting sees the real client IP
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max audio file
});
const PORT   = process.env.PORT || 3003;

// --- Config ---
const DATA_DIR      = path.join(__dirname, 'data');
const HASH_FILE     = path.join(DATA_DIR, 'owner.hash');       // legacy (pre-username)
const OWNER_FILE    = path.join(DATA_DIR, 'owner.json');       // { username, passwordHash }
const OWNER_BACKUP  = path.join(DATA_DIR, 'owner.hash.backup'); // migration safety net
const GEN_FILE      = path.join(DATA_DIR, 'session.generation');
const SECRET_FILE   = path.join(DATA_DIR, 'session.secret');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PROMPTS_FILE  = path.join(DATA_DIR, 'prompts.json');
const PROMPTS_VERSION_FILE = path.join(DATA_DIR, 'prompts.version');
const PROMPTS_VERSION = '7'; // bump when the built-in default replaces stored overrides
const LEGACY_PROMPTS_FILE = path.join(__dirname, 'prompts.json');
const BCRYPT_ROUNDS = 12;
// Deliberate change from the old no-expiry session: tokens now have an absolute
// 180-day lifetime. Active users get a fresh token via the sliding refresh.
const SESSION_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years (browser cap workaround)
const SESSION_REFRESH_AFTER = 30 * 24 * 60 * 60 * 1000; // re-issue if older than 30 days
const SESSION_MAX_AGE_MS = DEFAULT_MAX_AGE_MS; // 180 days
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === '1'
  || String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
const MAX_CUSTOM_PROMPTS = 4;
const AI_TIMEOUT_MS = 120_000; // 2 minutes
const POLLING_TIMEOUT_MS = 10 * 60_000; // submit+poll protocols need a longer budget

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
migrateOwnerRecord({ ownerFile: OWNER_FILE, hashFile: HASH_FILE, backupFile: OWNER_BACKUP });

// --- In-memory caches (read once at startup, re-read on write) ---
let settingsCache = null;
let promptsCache  = null;
let sessionSecretCache = null;

// --- Settings (API config) ---
function loadSettings() {
  if (settingsCache) return settingsCache;
  if (!fs.existsSync(SETTINGS_FILE)) { settingsCache = {}; return settingsCache; }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    // Decrypt legacy single-slot keys so the rest of the app works with plaintext.
    if (raw.TRANSCRIPTION_API_KEY) raw.TRANSCRIPTION_API_KEY = decryptSecret(raw.TRANSCRIPTION_API_KEY);
    if (raw.GEMINI_TRANSCRIPTION_API_KEY) raw.GEMINI_TRANSCRIPTION_API_KEY = decryptSecret(raw.GEMINI_TRANSCRIPTION_API_KEY);
    if (raw.CLEANUP_API_KEY) raw.CLEANUP_API_KEY = decryptSecret(raw.CLEANUP_API_KEY);
    // Decrypt each saved profile's key.
    for (const listName of ['TRANSCRIPTION_PROFILES', 'CLEANUP_PROFILES']) {
      if (!Array.isArray(raw[listName])) continue;
      for (const p of raw[listName]) {
        if (p.apiKey) p.apiKey = decryptSecret(p.apiKey);
      }
    }
    const beforeProfiles = JSON.stringify(raw.TRANSCRIPTION_PROFILES || null);
    const migrated = providers.migrateSettings(raw);
    settingsCache = migrated;
    // Persist the migration so profiles are the only source of truth from now
    // on, and so provider re-routing (e.g. a transcribe model) sticks.
    const profilesChanged = JSON.stringify(migrated.TRANSCRIPTION_PROFILES || null) !== beforeProfiles;
    if (!Array.isArray(raw.TRANSCRIPTION_PROFILES) || !Array.isArray(raw.CLEANUP_PROFILES) || profilesChanged) {
      saveSettings(migrated);
    }
  } catch { settingsCache = {}; }
  return settingsCache;
}

function saveSettings(settings) {
  settingsCache = settings; // cache stays plaintext for app use
  // Encrypt keys at rest so a leaked settings.json doesn't expose API keys.
  const toWrite = { ...settings };
  if (settings.TRANSCRIPTION_API_KEY) toWrite.TRANSCRIPTION_API_KEY = encryptSecret(settings.TRANSCRIPTION_API_KEY);
  if (settings.GEMINI_TRANSCRIPTION_API_KEY) toWrite.GEMINI_TRANSCRIPTION_API_KEY = encryptSecret(settings.GEMINI_TRANSCRIPTION_API_KEY);
  if (settings.CLEANUP_API_KEY) toWrite.CLEANUP_API_KEY = encryptSecret(settings.CLEANUP_API_KEY);
  for (const listName of ['TRANSCRIPTION_PROFILES', 'CLEANUP_PROFILES']) {
    if (!Array.isArray(settings[listName])) continue;
    toWrite[listName] = settings[listName].map(p => ({
      ...p,
      apiKey: p.apiKey ? encryptSecret(p.apiKey) : ''
    }));
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toWrite, null, 2), 'utf8');
}

function getEffectiveSetting(key) {
  const settings = loadSettings();
  // Explicit settings (including empty string) take priority over .env
  if (key in settings) return settings[key];
  return process.env[key] || '';
}

// --- API key encryption at rest ---
// Keys are stored encrypted with AES-256-GCM. The encryption key derives from
// the random session secret, so reading settings.json alone is not enough to
// recover API keys. NEVER rotate session.secret to kill sessions — that would
// orphan every saved API key. The session generation counter does that job.
function getEncryptionKey() {
  return crypto.createHash('sha256').update(getSessionSecret()).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = { iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
  return 'enc:v1:' + Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decryptSecret(value) {
  if (!value || !value.startsWith('enc:v1:')) return value;
  try {
    const payload = JSON.parse(Buffer.from(value.slice('enc:v1:'.length), 'base64').toString('utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('Could not decrypt stored API key — please re-enter it in Settings.', e.message);
    return '';
  }
}

// --- Auth ---
function getSessionSecret() {
  if (sessionSecretCache) return sessionSecretCache;
  if (!fs.existsSync(SECRET_FILE)) {
    const secret = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, 'utf8');
    sessionSecretCache = secret;
    return secret;
  }
  sessionSecretCache = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  return sessionSecretCache;
}

function getSessionGeneration() {
  if (!fs.existsSync(GEN_FILE)) writeFileAtomic(GEN_FILE, '1');
  const value = fs.readFileSync(GEN_FILE, 'utf8').trim();
  return /^\d+$/.test(value) ? value : '1';
}

function bumpSessionGeneration() {
  writeFileAtomic(GEN_FILE, String(parseInt(getSessionGeneration(), 10) + 1));
}

function getOwnerRecord() {
  return readOwnerRecord(OWNER_FILE);
}

function getOwnerHash() {
  const record = getOwnerRecord();
  if (record) return record.passwordHash;
  if (!fs.existsSync(HASH_FILE)) return null;
  return fs.readFileSync(HASH_FILE, 'utf8').trim();
}

function getOwnerUsername() {
  const record = getOwnerRecord();
  return record && typeof record.username === 'string' && record.username ? record.username : null;
}

function isOwnerSetup() { return !!getOwnerRecord() || fs.existsSync(HASH_FILE); }

function cookieOptions() {
  const opts = { signed: true, httpOnly: true, sameSite: 'strict', maxAge: SESSION_COOKIE_MAX_AGE };
  if (COOKIE_SECURE) opts.secure = true;
  return opts;
}

function issueSession(res) {
  res.cookie('session', createSessionToken(getSessionSecret(), getSessionGeneration()), cookieOptions());
}

function isAuthenticated(req) {
  const token = req.signedCookies && req.signedCookies.session;
  return verifySessionToken(token, {
    secret: getSessionSecret(),
    generation: getSessionGeneration(),
    maxAgeMs: SESSION_MAX_AGE_MS
  });
}

// --- Middleware ---
// Same-origin only; no CORS needed for a cookie-authenticated app
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(getSessionSecret()));

// CSRF layer two: Origin/Referer host validation on every mutation. SameSite
// cookies are one layer, not proof.
const MUTATION_PREFIXES = ['/setup', '/login', '/change-password', '/api/', '/prompts'];
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!MUTATION_PREFIXES.some(p => req.path === p || req.path.startsWith(p))) return next();
  const allowed = process.env.ALLOWED_ORIGINS || getEffectiveSetting('ALLOWED_ORIGINS');
  if (!isSameOriginRequest({
    origin: req.get('origin'),
    referer: req.get('referer'),
    host: req.get('host'),
    forwardedHost: req.get('x-forwarded-host'),
    allowedOrigins: allowed ? String(allowed).split(',') : []
  })) {
    return res.status(403).json({ error: 'Cross-origin request rejected.' });
  }
  next();
});

app.use((req, res, next) => {
  req.isOwner = isAuthenticated(req);
  // Sliding refresh: re-issue the cookie when the token is older than
  // SESSION_REFRESH_AFTER, so active users never hit the browser-side cap.
  if (req.isOwner) {
    try {
      const token = req.signedCookies && req.signedCookies.session;
      const ts = token ? parseInt(token.split(':')[0], 10) : NaN;
      if (!isNaN(ts) && Date.now() - ts > SESSION_REFRESH_AFTER) issueSession(res);
    } catch {}
  }
  next();
});

function requireOwner(req, res, next) {
  if (!req.isOwner) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Rate limiter for auth endpoints (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts, please try again later.'
});

// --- Configurable limits for AI endpoints (protect API credits from abuse) ---
const DEFAULT_RATE_LIMITS = {
  UPLOAD:  { max: 40, windowMs: 15 * 60 * 1000 }, // ~160 transcriptions/hour max
  CLEANUP: { max: 60, windowMs: 15 * 60 * 1000 }  // ~240 cleanups/hour max
};

function getLimitConfig(kind) {
  const prefix = 'RATE_LIMIT_' + kind;
  const def = DEFAULT_RATE_LIMITS[kind] || DEFAULT_RATE_LIMITS.UPLOAD;
  const max = Number(getEffectiveSetting(prefix + '_MAX'));
  const windowMs = Number(getEffectiveSetting(prefix + '_WINDOW_MS'));
  return {
    max: Number.isFinite(max) && max > 0 ? max : def.max,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : def.windowMs
  };
}

const aiUploadLimiter = rateLimit({
  windowMs: getLimitConfig('UPLOAD').windowMs,
  max: getLimitConfig('UPLOAD').max,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many transcription requests — please wait a few minutes and try again.'
});

const aiCleanupLimiter = rateLimit({
  windowMs: getLimitConfig('CLEANUP').windowMs,
  max: getLimitConfig('CLEANUP').max,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many cleanup requests — please wait a few minutes and try again.'
});

const DEFAULT_MAX_TRANSCRIPT_CHARS = 50000;
function getMaxTranscriptChars() {
  const val = Number(getEffectiveSetting('MAX_TRANSCRIPT_CHARS'));
  return Number.isFinite(val) && val > 0 ? val : DEFAULT_MAX_TRANSCRIPT_CHARS;
}

// --- Auth Routes ---
app.get('/setup', (req, res) => {
  if (isOwnerSetup()) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.post('/setup', authLimiter, async (req, res) => {
  if (isOwnerSetup()) return res.redirect('/login');
  const { username, password, confirm } = req.body;
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) return res.redirect('/setup?error=username');
  const pwCheck = validateNewPassword(password, confirm);
  if (!pwCheck.ok) {
    const code = /at least/.test(pwCheck.error) ? 'short'
      : /bytes/.test(pwCheck.error) ? 'long'
      : 'mismatch';
    return res.redirect('/setup?error=' + code);
  }

  writeOwnerRecord(OWNER_FILE, {
    username: nameCheck.username,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS)
  });
  issueSession(res);
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  if (req.isOwner) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

function usernameMatches(submitted, stored) {
  const a = Buffer.from(normalizeUsername(submitted).toLowerCase(), 'utf8');
  const b = Buffer.from(String(stored || '').toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

app.post('/login', authLimiter, async (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  const { password } = req.body;
  const hash = getOwnerHash();
  const storedUsername = getOwnerUsername();
  if (!password || !hash) return res.redirect('/login?error=1');

  // Once a username exists, both are checked; a wrong name and a wrong password
  // return the same generic error (no account enumeration).
  if (storedUsername) {
    if (!usernameMatches(req.body.username, storedUsername)) return res.redirect('/login?error=1');
  }
  if (!(await bcrypt.compare(password, hash))) return res.redirect('/login?error=1');

  issueSession(res);
  res.redirect('/');
});

async function changePasswordHandler(req, res) {
  if (!isOwnerSetup()) return res.status(400).json({ error: 'No password set yet.' });
  const { currentPassword, newPassword, confirm } = req.body;
  if (!currentPassword || !newPassword || !confirm) return res.status(400).json({ error: 'All fields are required.' });
  const pwCheck = validateNewPassword(newPassword, confirm);
  if (!pwCheck.ok) return res.status(400).json({ error: pwCheck.error });

  const hash = getOwnerHash();
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const record = getOwnerRecord() || { username: getOwnerUsername(), passwordHash: hash };
  writeOwnerRecord(OWNER_FILE, {
    username: record.username == null ? null : record.username,
    passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  });
  // Every existing cookie dies — including an attacker's. This browser stays
  // signed in because we re-issue a token for the new generation.
  bumpSessionGeneration();
  issueSession(res);
  res.json({ ok: true });
}

app.post('/change-password', authLimiter, changePasswordHandler);

app.get('/logout', (req, res) => { res.clearCookie('session'); res.redirect('/login'); });

// --- Account ---
app.get('/api/account', requireOwner, (req, res) => {
  res.json({ username: getOwnerUsername(), needsUsername: !getOwnerUsername() });
});

app.post('/api/account/username', requireOwner, async (req, res) => {
  const { username, currentPassword } = req.body;
  const nameCheck = validateUsername(username);
  if (!nameCheck.ok) return res.status(400).json({ error: nameCheck.error });
  const hash = getOwnerHash();
  if (!hash || !currentPassword || !(await bcrypt.compare(currentPassword, hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const record = getOwnerRecord() || { username: null, passwordHash: hash };
  writeOwnerRecord(OWNER_FILE, { username: nameCheck.username, passwordHash: record.passwordHash });
  res.json({ ok: true, username: nameCheck.username });
});

app.post('/api/account/password', requireOwner, authLimiter, changePasswordHandler);

// --- Protected main page ---
app.get('/', (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  if (!req.isOwner) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Settings API ---
// Tiny authenticated health check used on the record-start critical path.
app.get('/api/status', requireOwner, (req, res) => {
  res.json({ ok: true });
});

function loadGlossary() {
  const stored = loadSettings().GLOSSARY;
  try { return normalizeGlossary(stored); }
  catch (e) {
    console.warn('Saved glossary is invalid — using the default Work profile:', e.message);
    return normalizeGlossary(null);
  }
}

app.get('/api/glossary', requireOwner, (req, res) => {
  res.json(loadGlossary());
});

app.post('/api/glossary', requireOwner, (req, res) => {
  let glossary;
  try { glossary = normalizeGlossary(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const current = loadSettings();
  current.GLOSSARY = glossary;
  saveSettings(current);
  res.json({ ok: true, glossary });
});

app.get('/api/settings', requireOwner, (req, res) => {
  const s = loadSettings();
  res.json(providers.publicSettings(s));
});

// Recognition settings are global: every profile shares them.
app.post('/api/settings/recognition', requireOwner, (req, res) => {
  const { transcriptionLanguage, transcriptionHint } = req.body || {};
  const current = loadSettings();
  if (transcriptionLanguage !== undefined) current.TRANSCRIPTION_LANGUAGE = String(transcriptionLanguage);
  if (transcriptionHint !== undefined) current.TRANSCRIPTION_PROMPT = String(transcriptionHint);
  saveSettings(current);
  res.json({ ok: true });
});

app.post('/api/settings/fallback', requireOwner, (req, res) => {
  const current = loadSettings();
  const id = req.body && req.body.profileId;
  if (id != null && id !== '') {
    const profile = providers.findProfile(current, 'transcription', id);
    if (!profile) return res.status(400).json({ error: 'Unknown profile.' });
    if (profile.id === current.ACTIVE_TRANSCRIPTION_PROFILE) {
      return res.status(400).json({ error: 'The active model cannot also be the fallback.' });
    }
    if (!profile.apiKey) {
      return res.status(400).json({ error: 'That profile has no API key yet.' });
    }
    current.FALLBACK_TRANSCRIPTION_PROFILE = id;
  } else {
    delete current.FALLBACK_TRANSCRIPTION_PROFILE;
  }
  saveSettings(current);
  res.json({ ok: true, fallbackTranscriptionProfile: current.FALLBACK_TRANSCRIPTION_PROFILE || null });
});

// Legacy settings update kept for backward compatibility (recognition only).
app.post('/api/settings', requireOwner, (req, res) => {
  const {
    transcriptionLanguage, transcriptionHint,
    transcriptionEngine, transcriptionKey, transcriptionUrl, transcriptionModel,
    geminiTranscriptionKey, geminiTranscriptionUrl, geminiTranscriptionModel,
    cleanupKey, cleanupUrl, cleanupModel
  } = req.body;
  const current = loadSettings();

  if (transcriptionLanguage !== undefined) current.TRANSCRIPTION_LANGUAGE = transcriptionLanguage;
  if (transcriptionHint !== undefined) current.TRANSCRIPTION_PROMPT = transcriptionHint;

  // Legacy key fields still create/update a profile rather than reviving slots.
  if (transcriptionKey || transcriptionUrl || transcriptionModel || transcriptionEngine) {
    const existing = (current.TRANSCRIPTION_PROFILES || []).find(p => p.id === 'prof_whisper');
    const engine = transcriptionEngine || (existing && existing.engine) || 'whisper';
    const target = engine === 'gemini' ? 'prof_gemini' : 'prof_whisper';
    upsertLegacyProfile(current, target, engine, {
      key: transcriptionKey, url: transcriptionUrl, model: transcriptionModel
    });
  }
  if (geminiTranscriptionKey || geminiTranscriptionUrl || geminiTranscriptionModel) {
    upsertLegacyProfile(current, 'prof_gemini', 'gemini', {
      key: geminiTranscriptionKey, url: geminiTranscriptionUrl, model: geminiTranscriptionModel
    });
  }
  if (cleanupKey || cleanupUrl || cleanupModel) {
    const existing = (current.CLEANUP_PROFILES || []).find(p => p.id === 'prof_cleanup');
    const preset = providers.matchPreset(cleanupUrl || (existing && existing.baseUrl), providers.CLEANUP_PROVIDERS);
    if (!existing) {
      current.CLEANUP_PROFILES = current.CLEANUP_PROFILES || [];
      current.CLEANUP_PROFILES.push({
        id: 'prof_cleanup',
        label: cleanupModel || 'Cleanup',
        provider: preset || 'custom',
        baseUrl: preset ? '' : (cleanupUrl || ''),
        model: cleanupModel || '',
        apiKey: cleanupKey || ''
      });
      current.ACTIVE_CLEANUP_PROFILE = 'prof_cleanup';
    } else {
      if (cleanupKey) existing.apiKey = cleanupKey;
      if (cleanupUrl !== undefined) {
        existing.provider = preset || 'custom';
        existing.baseUrl = preset ? '' : cleanupUrl;
      }
      if (cleanupModel !== undefined) existing.model = cleanupModel;
    }
  }

  saveSettings(current);
  res.json({ ok: true });
});

function upsertLegacyProfile(settings, id, engine, fields) {
  settings.TRANSCRIPTION_PROFILES = settings.TRANSCRIPTION_PROFILES || [];
  let profile = settings.TRANSCRIPTION_PROFILES.find(p => p.id === id);
  if (!profile) {
    profile = {
      id,
      label: engine === 'gemini' ? 'Gemini' : 'Whisper-compatible',
      provider: engine === 'gemini' ? 'gemini' : 'custom',
      engine,
      baseUrl: '',
      model: '',
      apiKey: ''
    };
    settings.TRANSCRIPTION_PROFILES.push(profile);
    if (!settings.ACTIVE_TRANSCRIPTION_PROFILE) settings.ACTIVE_TRANSCRIPTION_PROFILE = id;
  }
  if (fields.key) profile.apiKey = fields.key;
  if (fields.model !== undefined && fields.model !== '') profile.model = fields.model;
  if (engine === 'gemini') {
    profile.provider = 'gemini';
    profile.baseUrl = '';
  } else if (fields.url !== undefined) {
    const preset = providers.matchPreset(fields.url);
    profile.provider = preset || 'custom';
    profile.engine = 'whisper';
    profile.baseUrl = preset ? '' : fields.url;
  }
}

// --- Profiles API ---
const PROFILE_KINDS = {
  transcription: {
    list: 'TRANSCRIPTION_PROFILES',
    active: 'ACTIVE_TRANSCRIPTION_PROFILE',
    catalog: 'TRANSCRIPTION_PROVIDERS',
    label: 'Transcription'
  },
  cleanup: {
    list: 'CLEANUP_PROFILES',
    active: 'ACTIVE_CLEANUP_PROFILE',
    catalog: 'CLEANUP_PROVIDERS',
    label: 'Cleanup'
  }
};

function validateProfileInput(kind, body, { requireKey }) {
  const meta = PROFILE_KINDS[kind];
  const catalog = providers[meta.catalog];
  const provider = String(body.provider || 'custom');
  if (!catalog[provider]) return { error: 'Unknown provider.' };
  const model = String(body.model || '').trim();
  const label = String(body.label || '').trim();
  const baseUrl = String(body.baseUrl || '').trim();
  if (kind === 'transcription' && provider === 'custom' && !baseUrl) {
    return { error: 'A base URL is required for a custom provider.' };
  }
  if (kind === 'cleanup' && provider === 'custom' && !baseUrl) {
    return { error: 'A base URL is required for a custom provider.' };
  }
  if (requireKey && !body.key) return { error: 'API key is required.' };
  if (label.length > 60) return { error: 'Profile name must be 60 characters or fewer.' };
  return {
    value: {
      provider,
      model,
      label: label || catalog[provider].name,
      baseUrl: provider === 'custom' ? baseUrl : '',
      engine: String(body.engine || 'whisper')
    }
  };
}

function registerProfileRoutes(kind) {
  const meta = PROFILE_KINDS[kind];
  const base = `/api/profiles/${kind}`;

  app.post(base, requireOwner, (req, res) => {
    const checked = validateProfileInput(kind, req.body, { requireKey: true });
    if (checked.error) return res.status(400).json({ error: checked.error });
    const current = loadSettings();
    current[meta.list] = current[meta.list] || [];
    const id = providers.makeId(`prof_${kind}`, current[meta.list].map(p => p.id));
    const profile = { id, ...checked.value, apiKey: req.body.key };
    current[meta.list].push(profile);
    if (!current[meta.active]) current[meta.active] = id;
    saveSettings(current);
    res.json({
      ok: true,
      profile: providers.publicProfile(profile, kind, current[meta.active]),
      activeProfile: current[meta.active]
    });
  });

  app.patch(`${base}/:id`, requireOwner, (req, res) => {
    const current = loadSettings();
    const profile = providers.findProfile(current, kind, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (req.body.provider !== undefined || req.body.model !== undefined
      || req.body.label !== undefined || req.body.baseUrl !== undefined) {
      const checked = validateProfileInput(kind, {
        provider: req.body.provider === undefined ? profile.provider : req.body.provider,
        model: req.body.model === undefined ? profile.model : req.body.model,
        label: req.body.label === undefined ? profile.label : req.body.label,
        baseUrl: req.body.baseUrl === undefined ? profile.baseUrl : req.body.baseUrl,
        engine: req.body.engine === undefined ? profile.engine : req.body.engine
      }, { requireKey: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      Object.assign(profile, checked.value);
    }
    if (req.body.key) profile.apiKey = req.body.key;
    saveSettings(current);
    res.json({ ok: true, profile: providers.publicProfile(profile, kind, current[meta.active]) });
  });

  app.delete(`${base}/:id`, requireOwner, (req, res) => {
    const current = loadSettings();
    if (current[meta.active] === req.params.id) {
      return res.status(400).json({ error: 'Activate another profile before deleting this one.' });
    }
    const before = current[meta.list] || [];
    current[meta.list] = before.filter(p => p.id !== req.params.id);
    if (current[meta.list].length === before.length) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    if (current.FALLBACK_TRANSCRIPTION_PROFILE === req.params.id) delete current.FALLBACK_TRANSCRIPTION_PROFILE;
    saveSettings(current);
    res.json({ ok: true });
  });

  app.post(`${base}/:id/activate`, requireOwner, (req, res) => {
    const current = loadSettings();
    const profile = providers.findProfile(current, kind, req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    current[meta.active] = profile.id;
    // A profile cannot be both active and fallback: the fallback would be a no-op.
    if (kind === 'transcription' && current.FALLBACK_TRANSCRIPTION_PROFILE === profile.id) {
      delete current.FALLBACK_TRANSCRIPTION_PROFILE;
    }
    saveSettings(current);
    res.json({
      ok: true,
      activeProfile: profile.id,
      fallbackTranscriptionProfile: current.FALLBACK_TRANSCRIPTION_PROFILE || null
    });
  });
}

registerProfileRoutes('transcription');
registerProfileRoutes('cleanup');

// Protocol of the active transcription profile, for the Record tab (it needs to
// know when to hand over 16 kHz WAV for Cartesia).
app.get('/api/active-profile', requireOwner, (req, res) => {
  const profile = getActiveTranscriptionProfile();
  res.json(profile ? {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    protocol: profile.protocol,
    model: profile.model,
    supportsStreaming: profile.protocol === 'cartesia'
  } : { protocol: 'none', supportsStreaming: false });
});

// --- Live streaming (Cartesia) ---
// Short-lived, single-use token so the WebSocket upgrade can be authenticated
// without parsing signed cookies by hand.
const STREAM_TOKEN_TTL_MS = 60_000;
const streamTokens = new Map();

function issueStreamToken() {
  const token = crypto.randomBytes(24).toString('hex');
  streamTokens.set(token, Date.now() + STREAM_TOKEN_TTL_MS);
  // Opportunistic cleanup of expired tokens.
  for (const [key, expires] of streamTokens) {
    if (expires <= Date.now()) streamTokens.delete(key);
  }
  return token;
}

function consumeStreamToken(token) {
  if (!token) return false;
  const expires = streamTokens.get(token);
  streamTokens.delete(token);
  return !!expires && expires > Date.now();
}

app.post('/api/stream-token', requireOwner, (req, res) => {
  const profile = getActiveTranscriptionProfile();
  if (!profile || profile.protocol !== 'cartesia') {
    return res.status(400).json({ error: 'The active voice model does not support live streaming.' });
  }
  res.json({ token: issueStreamToken(), expiresInMs: STREAM_TOKEN_TTL_MS });
});

function cartesiaStreamUrl(profile) {
  const params = new URLSearchParams({
    model: profile.model || 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: '16000',
    cartesia_version: '2026-03-01'
  });
  return `wss://api.cartesia.ai/stt/turns/websocket?${params.toString()}`;
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (client, req) => {
  const url = new URL(req.url, 'http://localhost');
  if (!consumeStreamToken(url.searchParams.get('token'))) {
    client.close(1008, 'Unauthorized');
    return;
  }
  const profile = getActiveTranscriptionProfile();
  if (!profile || profile.protocol !== 'cartesia' || !profile.apiKey) {
    client.close(1011, 'No streaming model configured');
    return;
  }

  let upstream;
  let upstreamReady = false;
  const pendingAudio = [];
  let closed = false;
  let clientGone = false;

  const shutdown = (code, reason) => {
    if (closed) return;
    closed = true;
    try { if (upstream) upstream.close(); } catch {}
    try { if (client.readyState === WebSocket.OPEN) client.close(code || 1000, reason); } catch {}
  };

  console.log(`Stream open: ${profile.provider}/${profile.model}`);
  try {
    upstream = new WebSocket(cartesiaStreamUrl(profile), {
      headers: { 'X-API-Key': profile.apiKey }
    });
  } catch (err) {
    client.send(JSON.stringify({ type: 'error', error: err.message }));
    return shutdown(1011);
  }

  upstream.on('open', () => {
    upstreamReady = true;
    for (const frame of pendingAudio.splice(0)) upstream.send(frame);
    try { client.send(JSON.stringify({ type: 'ready' })); } catch {}
  });

  upstream.on('message', (raw) => {
    const event = streamLib.normalizeEvent(raw.toString());
    if (event.type === 'other') return;
    try { client.send(JSON.stringify(event)); } catch {}
    if (event.type === 'done') shutdown(1000);
  });

  upstream.on('error', (err) => {
    console.error('Cartesia stream error:', err.message);
    try { client.send(JSON.stringify({ type: 'error', error: 'Streaming provider connection failed.' })); } catch {}
    shutdown(1011);
  });

  upstream.on('close', (code, reason) => {
    console.log(`Stream upstream closed: ${code} ${reason || ''}`.trim());
    if (!closed) {
      if (!clientGone && code !== 1000) {
        try {
          client.send(JSON.stringify({
            type: 'error',
            error: `Streaming provider closed unexpectedly (${code})` + (reason ? ': ' + reason : '')
          }));
        } catch {}
      }
      try { client.send(JSON.stringify({ type: 'done' })); } catch {}
      shutdown(1000);
    }
  });

  client.on('message', (data, isBinary) => {
    if (closed) return;
    if (isBinary) {
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(data);
      else if (pendingAudio.length < 200) pendingAudio.push(data);
      return;
    }
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.type === 'close') shutdown(1000);
  });

  client.on('close', () => { clientGone = true; shutdown(1000); });
  client.on('error', () => shutdown(1011));
});

// --- Prompts API ---
// Version 2 moves the "Default" prompt into the client code. Any stored default
// override (the old editable copy) is dropped once, so Restore now reveals the
// new built-in text instead of an older one.
function migratePromptOverrides(list) {
  const safe = Array.isArray(list) ? list : [];
  let stored = '';
  try { stored = fs.readFileSync(PROMPTS_VERSION_FILE, 'utf8').trim(); } catch {}
  if (stored && Number(stored) >= Number(PROMPTS_VERSION)) return safe;
  const filtered = safe.filter(p => p && p.id !== 'default');
  if (filtered.length !== safe.length) {
    fs.writeFileSync(PROMPTS_FILE, JSON.stringify(filtered, null, 2));
  }
  fs.writeFileSync(PROMPTS_VERSION_FILE, PROMPTS_VERSION);
  return filtered;
}

function loadPrompts() {
  if (promptsCache) return promptsCache;
  if (!fs.existsSync(PROMPTS_FILE) && fs.existsSync(LEGACY_PROMPTS_FILE)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_PROMPTS_FILE, 'utf8'));
      const migrated = migratePromptOverrides(legacy);
      fs.writeFileSync(PROMPTS_FILE, JSON.stringify(migrated, null, 2));
      fs.unlinkSync(LEGACY_PROMPTS_FILE);
      promptsCache = migrated;
      return promptsCache;
    } catch { promptsCache = []; return promptsCache; }
  }
  if (!fs.existsSync(PROMPTS_FILE)) {
    migratePromptOverrides([]);
    promptsCache = [];
    return promptsCache;
  }
  try { promptsCache = migratePromptOverrides(JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'))); }
  catch { promptsCache = []; }
  return promptsCache;
}

function savePrompts(prompts) {
  promptsCache = prompts;
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
}

app.get('/prompts', requireOwner, (req, res) => { res.json(loadPrompts()); });

app.post('/prompts', requireOwner, (req, res) => {
  const { id, name, text } = req.body;
  if (!id || !name || !text) return res.status(400).json({ error: 'id, name and text required' });
  const prompts = loadPrompts();
  const idx = prompts.findIndex(p => p.id === id);
  if (idx >= 0) { prompts[idx] = { id, name, text }; }
  else {
    if (prompts.length >= MAX_CUSTOM_PROMPTS) return res.status(400).json({ error: `Max ${MAX_CUSTOM_PROMPTS} prompts` });
    prompts.push({ id, name, text });
  }
  savePrompts(prompts);
  res.json({ ok: true });
});

app.delete('/prompts/:id', requireOwner, (req, res) => {
  savePrompts(loadPrompts().filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// --- Transcription & Cleanup resolution ---
function envTranscriptionProfile() {
  if (!process.env.TRANSCRIPTION_API_KEY) return null;
  return providers.resolveProfile({
    id: 'env_whisper',
    label: 'Environment',
    provider: providers.matchPreset(process.env.TRANSCRIPTION_BASE_URL) || 'custom',
    engine: 'whisper',
    baseUrl: process.env.TRANSCRIPTION_BASE_URL || '',
    model: process.env.TRANSCRIPTION_MODEL || 'whisper-1',
    apiKey: process.env.TRANSCRIPTION_API_KEY
  }, 'transcription');
}

function getActiveTranscriptionProfile() {
  const settings = loadSettings();
  const active = providers.getActiveProfile(settings, 'transcription');
  if (active) return active;
  // .env fallback applies only when no profile is configured at all.
  const configured = Array.isArray(settings.TRANSCRIPTION_PROFILES) && settings.TRANSCRIPTION_PROFILES.length > 0;
  return configured ? null : envTranscriptionProfile();
}

function getExplicitFallbackProfile() {
  return providers.getFallbackProfile(loadSettings());
}

function getCleanupProfile() {
  const settings = loadSettings();
  const resolved = providers.getActiveProfile(settings, 'cleanup');
  if (resolved) return resolved;
  const configured = Array.isArray(settings.CLEANUP_PROFILES) && settings.CLEANUP_PROFILES.length > 0;
  if (configured) return null;
  const key = process.env.CLEANUP_API_KEY;
  if (!key) return null;
  return {
    id: 'env_cleanup',
    provider: 'custom',
    protocol: 'chat',
    baseUrl: process.env.CLEANUP_BASE_URL || '',
    model: process.env.CLEANUP_MODEL || 'gpt-4.1-mini',
    apiKey: key
  };
}

// OpenCode Go asks non-OpenCode clients to identify themselves with a session
// header and a custom user agent.
function openCodeHeaders(profileOrProvider) {
  const provider = typeof profileOrProvider === 'string' ? profileOrProvider : profileOrProvider && profileOrProvider.provider;
  if (provider !== 'opencode_go') return {};
  return {
    'x-opencode-session': OPENCODE_SESSION_ID,
    'User-Agent': `ai-dictation-app/${APP_VERSION}`
  };
}

function getCleanupClient() {
  const profile = getCleanupProfile();
  if (!profile) throw new Error('Cleanup API key not configured. Go to Settings tab.');
  const headers = openCodeHeaders(profile);
  return new OpenAI({
    apiKey: profile.apiKey,
    baseURL: profile.baseUrl || undefined,
    timeout: AI_TIMEOUT_MS,
    maxRetries: 2,
    ...(Object.keys(headers).length ? { defaultHeaders: headers } : {})
  });
}

function getCleanupModel() {
  const profile = getCleanupProfile();
  return (profile && profile.model) || 'gpt-4.1-mini';
}

function geminiAudioFormat(mimeType) {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  if (m.includes('wav') || m.includes('x-wav')) return 'wav';
  return null;
}

async function transcribeWithWhisper(audioPath, mimeType, originalName, opts = {}) {
  const profile = opts.profile;
  if (!profile || !profile.apiKey) throw new Error('Transcription API key not configured. Go to Settings tab.');
  const client = new OpenAI({
    apiKey: profile.apiKey,
    baseURL: profile.baseUrl || undefined,
    timeout: AI_TIMEOUT_MS,
    maxRetries: opts.maxRetries === undefined ? 2 : opts.maxRetries
  });
  const model = profile.model || 'whisper-1';
  const language = getEffectiveSetting('TRANSCRIPTION_LANGUAGE');
  const hint = getEffectiveSetting('TRANSCRIPTION_PROMPT');

  const audioBuffer = fs.readFileSync(audioPath);
  const type = mimeType || 'application/octet-stream';
  const ext = extensionForMime(type);
  const name = originalName && path.extname(originalName)
    ? path.basename(originalName)
    : `audio.${ext}`;
  const params = {
    file: await toFile(audioBuffer, name, { type }),
    model
  };
  if (language) params.language = language;
  if (hint) params.prompt = hint;

  const transcription = await client.audio.transcriptions.create(params);
  return (transcription && transcription.text) || '';
}

async function transcribeWithGemini(audioPath, mimeType, opts = {}) {
  const profile = opts.profile;
  if (!profile || !profile.apiKey) throw new Error('Gemini transcription API key not configured. Go to Settings tab.');
  const format = geminiAudioFormat(mimeType);
  if (!format) throw new Error('This audio format is not supported by Gemini (only wav/mp3).');
  const model = profile.model || 'gemini-2.5-flash';
  const baseURL = (profile.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
  const language = getEffectiveSetting('TRANSCRIPTION_LANGUAGE');
  const hint = getEffectiveSetting('TRANSCRIPTION_PROMPT');

  const audioB64 = fs.readFileSync(audioPath).toString('base64');
  let instruction = 'Transcribe the audio verbatim. Output only the transcribed text with no commentary.';
  if (language) instruction += ` The audio is in language code: ${language}.`;
  if (hint) instruction += ` Use this vocabulary for proper nouns and jargon: ${hint}.`;

  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'input_audio', input_audio: { data: audioB64, format } }
      ]
    }]
  };

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${profile.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`Gemini transcription failed (${resp.status}): ${errText.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function transcribeWithProfile(profile, audioPath, mimeType, originalName, opts = {}) {
  const common = {
    audioPath,
    mimeType,
    profile,
    language: getEffectiveSetting('TRANSCRIPTION_LANGUAGE'),
    hint: getEffectiveSetting('TRANSCRIPTION_PROMPT'),
    timeoutMs: profile.protocol === 'assemblyai' || profile.protocol === 'corti'
      ? POLLING_TIMEOUT_MS
      : AI_TIMEOUT_MS
  };
  switch (profile.protocol) {
    case 'whisper':
      return transcribeWithWhisper(audioPath, mimeType, originalName, { ...opts, profile });
    case 'gemini':
      return transcribeWithGemini(audioPath, mimeType, { ...opts, profile });
    case 'gemini-transcribe':
      return adapters.transcribeWithGeminiTranscribe(common);
    case 'elevenlabs': return adapters.transcribeWithElevenLabs(common);
    case 'deepgram':   return adapters.transcribeWithDeepgram(common);
    case 'cohere':     return adapters.transcribeWithCohere(common);
    case 'assemblyai': return adapters.transcribeWithAssemblyAI(common);
    case 'corti':      return adapters.transcribeWithCorti(common);
    case 'cartesia':   return adapters.transcribeWithCartesia(common);
    default:
      throw new Error(`Unsupported transcription protocol: ${profile.protocol}`);
  }
}

// The active profile is the only one used. On failure, fail clearly and keep
// the recording. A fallback runs only when explicitly enabled.
async function transcribeAudio(audioPath, mimeType, originalName, opts = {}) {
  const profile = getActiveTranscriptionProfile();
  if (!profile) {
    throw new Error('Transcription API key not configured. Open Settings and add a voice model.');
  }
  try {
    return await transcribeWithProfile(profile, audioPath, mimeType, originalName, opts);
  } catch (err) {
    const fallback = getExplicitFallbackProfile();
    if (fallback && fallback.id !== profile.id) {
      console.warn(`${profile.provider} failed (${err.message}) — using explicit fallback ${fallback.provider}.`);
      return transcribeWithProfile(fallback, audioPath, mimeType, originalName, opts);
    }
    throw err;
  }
}

// Provider auth failures are not app-session failures. Returning the provider's
// 401 verbatim made the client think the login had expired, so provider errors
// become 502 while real app auth stays 401.
function providerErrorStatus(error) {
  const status = Number(error && error.status);
  if (status === 401 || status === 403) return 400;
  return status >= 400 ? status : 500;
}

// --- Test connection endpoints ---
function makeSilenceWav(seconds = 1, sampleRate = 16000) {
  const samples = seconds * sampleRate;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function probeCartesiaStream(profile) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cartesiaStreamUrl(profile), {
      headers: { 'X-API-Key': profile.apiKey }
    });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Cartesia streaming probe timed out.')), 10_000);
    ws.on('open', () => setTimeout(() => finish(), 800));
    ws.on('error', (err) => finish(new Error('Cartesia streaming failed: ' + err.message)));
    ws.on('close', (code, reason) => {
      if (code !== 1000 && code !== 1005) {
        finish(new Error(`Cartesia streaming closed (${code}) ${reason || ''}`.trim()));
      }
    });
  });
}

async function probeProfile(profile) {
  const started = Date.now();
  const protocol = profile.protocol;
  if (protocol === 'whisper') {
    const client = new OpenAI({ apiKey: profile.apiKey, baseURL: profile.baseUrl || undefined, timeout: AI_TIMEOUT_MS });
    await client.models.list();
  } else if (protocol === 'gemini') {
    const baseURL = (profile.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${profile.apiKey}` },
      body: JSON.stringify({
        model: profile.model || 'gemini-2.5-flash',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    if (!resp.ok) throw new Error(`Gemini connection failed (${resp.status})`);
  } else if (['elevenlabs', 'deepgram', 'cohere', 'gemini-transcribe'].includes(protocol)) {
    // Exercise the real adapter with a short silent sample.
    const tmp = path.join(DATA_DIR, `probe-${Date.now()}.wav`);
    fs.writeFileSync(tmp, makeSilenceWav());
    try {
      const common = {
        audioPath: tmp,
        mimeType: 'audio/wav',
        profile,
        // Use the same recognition settings as a real transcription so the
        // test catches parameter errors (e.g. ElevenLabs language codes).
        language: getEffectiveSetting('TRANSCRIPTION_LANGUAGE'),
        hint: getEffectiveSetting('TRANSCRIPTION_PROMPT'),
        timeoutMs: AI_TIMEOUT_MS
      };
      if (protocol === 'elevenlabs') await adapters.transcribeWithElevenLabs(common);
      if (protocol === 'deepgram') await adapters.transcribeWithDeepgram(common);
      if (protocol === 'cohere') await adapters.transcribeWithCohere(common);
      if (protocol === 'gemini-transcribe') await adapters.transcribeWithGeminiTranscribe(common);
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  } else if (protocol === 'assemblyai') {
    const resp = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
      headers: { 'authorization': profile.apiKey },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    if (!resp.ok) throw new Error(`AssemblyAI connection failed (${resp.status})`);
  } else if (protocol === 'corti') {
    const base = (profile.baseUrl || 'https://api.corti.ai').replace(/\/+$/, '');
    const resp = await fetch(`${base}/v1/recordings?limit=1`, {
      headers: { 'Authorization': `Bearer ${profile.apiKey}` },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    if (!resp.ok) throw new Error(`Corti connection failed (${resp.status})`);
  } else if (protocol === 'cartesia') {
    // Validate the streaming path itself (key, model, API version), not just
    // the REST voices endpoint.
    await probeCartesiaStream(profile);
  }
  return Date.now() - started;
}

function buildProfileFromRequest(body, kind) {
  if (body.profileId) {
    const saved = providers.getActiveProfile(loadSettings(), kind);
    const current = loadSettings();
    const list = kind === 'cleanup' ? current.CLEANUP_PROFILES : current.TRANSCRIPTION_PROFILES;
    const profile = (list || []).find(p => p.id === body.profileId);
    if (profile && profile.apiKey) return providers.resolveProfile(profile, kind);
    if (saved && saved.id === body.profileId) return saved;
    return null;
  }
  const catalog = kind === 'cleanup' ? providers.CLEANUP_PROVIDERS : providers.TRANSCRIPTION_PROVIDERS;
  const provider = body.provider || body.engine || 'custom';
  const preset = catalog[provider] || {};
  if (!body.key && !preset.name) return null;
  return providers.resolveProfile({
    id: 'test',
    provider: catalog[provider] ? provider : (body.engine === 'gemini' ? 'gemini' : 'custom'),
    engine: body.engine || preset.protocol || 'whisper',
    baseUrl: body.url || body.baseUrl || '',
    model: body.model || '',
    apiKey: body.key || ''
  }, kind);
}

app.post('/api/test-transcription', requireOwner, async (req, res) => {
  try {
    const profile = buildProfileFromRequest(req.body, 'transcription');
    if (!profile) return res.status(400).json({ ok: false, error: 'Transcription API key is required.' });
    if (!profile.apiKey) return res.status(400).json({ ok: false, error: 'Transcription API key is required.' });
    const latencyMs = await probeProfile(profile);
    res.json({
      ok: true,
      latencyMs,
      message: `Connected — ${profile.providerName}${profile.model ? ' (' + profile.model + ')' : ''}`
    });
  } catch (error) {
    console.error('Test transcription error:', error.message);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/test-cleanup', requireOwner, async (req, res) => {
  try {
    const profile = buildProfileFromRequest(req.body, 'cleanup');
    if (!profile || !profile.apiKey) return res.status(400).json({ ok: false, error: 'Cleanup API key is required.' });
    const started = Date.now();
    const headers = openCodeHeaders(profile);
    const client = new OpenAI({
      apiKey: profile.apiKey,
      baseURL: profile.baseUrl || undefined,
      timeout: AI_TIMEOUT_MS,
      ...(Object.keys(headers).length ? { defaultHeaders: headers } : {})
    });
    await client.chat.completions.create({
      model: profile.model || 'gpt-4.1-mini',
      temperature: 0,
      max_tokens: 5,
      messages: [{ role: 'user', content: 'ping' }]
    });
    res.json({
      ok: true,
      latencyMs: Date.now() - started,
      message: `Connected — ${profile.providerName}${profile.model ? ' (' + profile.model + ')' : ''}`
    });
  } catch (error) {
    console.error('Test cleanup error:', error.message);
    res.status(400).json({ ok: false, error: error.message });
  }
});

// Browse models. Result order is deliberately curated-first: provider catalogs
// are the only list that is guaranteed to be relevant.
function mergeModelLists(curated, fetched) {
  const out = [];
  for (const id of [...(curated || []), ...(fetched || [])]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

async function listNativeGeminiModels(providerId, preset, key) {
  const base = (preset.baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
    .replace(/\/openai\/?$/, '')
    .replace(/\/+$/, '');
  const resp = await fetch(`${base}/models?key=${encodeURIComponent(key)}`, {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) {
      const err = new Error('Google rejected this API key (' + resp.status + '). Check the key in this profile.');
      err.status = resp.status;
      throw err;
    }
    throw new Error(`Model list failed (${resp.status})` + (detail ? ': ' + detail.slice(0, 200) : ''));
  }
  const data = await resp.json();
  const ids = (data.models || [])
    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map(m => m.name);
  return providers.filterModelIds(providerId, ids);
}

app.post('/api/models', requireOwner, async (req, res) => {
  const { provider, key, baseUrl, kind, profileId } = req.body || {};
  const catalog = kind === 'cleanup' ? providers.CLEANUP_PROVIDERS : providers.TRANSCRIPTION_PROVIDERS;
  const preset = catalog[provider] || {};
  const curated = Array.isArray(preset.models) ? preset.models : [];
  try {
    // Prefer the key of the profile being edited. Never send one provider's
    // saved key to a different provider.
    let apiKey = key;
    if (!apiKey && profileId) {
      const current = loadSettings();
      const list = kind === 'cleanup' ? current.CLEANUP_PROFILES : current.TRANSCRIPTION_PROFILES;
      const saved = (list || []).find(p => p.id === profileId);
      if (saved && saved.provider === provider && saved.apiKey) apiKey = saved.apiKey;
    }
    if (!apiKey) {
      const active = providers.getActiveProfile(loadSettings(), kind === 'cleanup' ? 'cleanup' : 'transcription');
      if (active && active.provider === provider) apiKey = active.apiKey;
    }
    if (!apiKey) return res.json({ ok: true, models: curated });

    let fetched = [];
    if (preset.modelsUrl) {
      // Some providers (OpenCode Go) expose the model list outside the
      // OpenAI-compatible base path.
      const resp = await fetch(preset.modelsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}`, ...openCodeHeaders(provider) },
        signal: AbortSignal.timeout(AI_TIMEOUT_MS)
      });
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          const err = new Error('The provider rejected this API key (' + resp.status + '). Check the key in this profile.');
          err.status = resp.status;
          throw err;
        }
        throw new Error(`Model list failed (${resp.status})`);
      }
      const data = await resp.json();
      const ids = (data.data || data.models || []).map(m => m.id || m.name || m);
      fetched = providers.filterModelIds(provider, ids);
    } else if (!kind && (provider === 'gemini' || provider === 'gemini_transcribe')) {
      fetched = await listNativeGeminiModels(provider, preset, apiKey);
    } else {
      const client = new OpenAI({
        apiKey,
        baseURL: (baseUrl || preset.baseUrl || '') || undefined,
        timeout: AI_TIMEOUT_MS
      });
      const list = await client.models.list();
      fetched = providers.filterModelIds(provider, (list.data || []).map(m => m.id));
    }
    res.json({ ok: true, models: mergeModelLists(curated, fetched) });
  } catch (error) {
    res.json({ ok: true, models: curated, warning: error.message });
  }
});

// Multer error handler — converts file size errors to clean JSON instead of crashing
function uploadErrorHandler(err, req, res, next) {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Audio file too large (max 50 MB). Try a shorter recording.' });
    }
    console.error('Upload middleware error:', err.message);
    return res.status(400).json({ error: err.message });
  }
  next();
}

// --- Temp upload sweeper ---
const UPLOAD_MAX_AGE_MS = 30 * 60 * 1000;
const UPLOAD_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function sweepStaleUploads() {
  const uploadsDir = path.join(__dirname, 'uploads');
  fs.readdir(uploadsDir, (err, files) => {
    if (err || files.length === 0) return;
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (statErr, stat) => {
        if (statErr || !stat.isFile()) return;
        if (now - stat.mtimeMs > UPLOAD_MAX_AGE_MS) fs.unlink(filePath, () => {});
      });
    }
  });
}

sweepStaleUploads();
setInterval(sweepStaleUploads, UPLOAD_SWEEP_INTERVAL_MS).unref();

app.post('/upload', requireOwner, aiUploadLimiter, upload.single('audio'), uploadErrorHandler, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    const audioPath = req.file.path;
    const mimeType = req.file.mimetype;
    const text = await transcribeAudio(audioPath, mimeType, req.file.originalname);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.json({ rawTranscript: text });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Upload error:', error.message);
    const status = providerErrorStatus(error);
    res.status(status).json({ error: error.message });
  }
});

app.post('/cleanup', requireOwner, aiCleanupLimiter, async (req, res) => {
  try {
    const { rawTranscript, prompt } = req.body;
    if (!rawTranscript) return res.status(400).json({ error: 'No transcript' });
    if (rawTranscript.length > getMaxTranscriptChars()) {
      return res.status(400).json({ error: `Transcript too long (max ${getMaxTranscriptChars().toLocaleString()} characters).` });
    }

    const client = getCleanupClient();
    const activePrompt = prompt || 'Clean up dictated text.';
    const cleanup = await client.chat.completions.create({
      model: getCleanupModel(),
      temperature: 0,
      messages: [
        { role: 'system', content: activePrompt },
        { role: 'user', content: `<transcript>${rawTranscript}</transcript>` }
      ]
    });
    res.json({ cleanedTranscript: cleanup.choices[0].message.content });
  } catch (error) {
    console.error('Cleanup error:', error.message);
    const status = providerErrorStatus(error);
    res.status(status).json({ error: error.message });
  }
});

// --- Streaming Cleanup (SSE) ---
app.post('/cleanup-stream', requireOwner, aiCleanupLimiter, async (req, res) => {
  try {
    const { rawTranscript, prompt } = req.body;
    if (!rawTranscript) return res.status(400).json({ error: 'No transcript' });
    if (rawTranscript.length > getMaxTranscriptChars()) {
      return res.status(400).json({ error: `Transcript too long (max ${getMaxTranscriptChars().toLocaleString()} characters).` });
    }

    const client = getCleanupClient();
    const activePrompt = prompt || 'Clean up dictated text.';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const upstream = new AbortController();
    const stream = await client.chat.completions.create({
      model: getCleanupModel(),
      temperature: 0,
      stream: true,
      messages: [
        { role: 'system', content: activePrompt },
        { role: 'user', content: `<transcript>${rawTranscript}</transcript>` }
      ]
    }, { signal: upstream.signal });

    let aborted = false;
    let finished = false;
    res.on('close', () => {
      if (!finished) {
        aborted = true;
        try { upstream.abort(); } catch {}
      }
    });

    for await (const chunk of stream) {
      if (aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
    }

    if (!aborted && !res.writableEnded) res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    finished = true;
    res.end();
  } catch (error) {
    console.error('Streaming cleanup error:', error.message);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      const status = providerErrorStatus(error);
      res.status(status).json({ error: error.message });
    }
  }
});

// --- Static files (AFTER all API routes) ---
app.use((req, res, next) => {
  const publicPaths = ['/login.html', '/setup.html', '/auth.css', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/sw.js'];
  if (publicPaths.includes(req.path) || req.path.startsWith('/fonts/')) return express.static(path.join(__dirname, 'public'))(req, res, next);
  if (!req.isOwner) return res.status(401).send('Unauthorized');
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

// Run the one-time prompts migration at startup so a stored Default override is
// dropped even before the first page load.
loadPrompts();

const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/stt-stream') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

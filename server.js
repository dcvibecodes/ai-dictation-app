require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const cookieParser = require('cookie-parser');
const OpenAI  = require('openai');
const rateLimit = require('express-rate-limit');

const app    = express();
app.set('trust proxy', 1); // Behind nginx — use X-Forwarded-For so rate limiting sees the real client IP
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max audio file
});
const PORT   = process.env.PORT || 3003;

// --- Config ---
const DATA_DIR      = path.join(__dirname, 'data');
const HASH_FILE     = path.join(DATA_DIR, 'owner.hash');
const SECRET_FILE   = path.join(DATA_DIR, 'session.secret');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PROMPTS_FILE  = path.join(DATA_DIR, 'prompts.json');
const LEGACY_PROMPTS_FILE = path.join(__dirname, 'prompts.json');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_CUSTOM_PROMPTS = 4;
const AI_TIMEOUT_MS = 120_000; // 2 minutes

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

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
    // Decrypt keys so the rest of the app works with plaintext values
    if (raw.TRANSCRIPTION_API_KEY) raw.TRANSCRIPTION_API_KEY = decryptSecret(raw.TRANSCRIPTION_API_KEY);
    if (raw.CLEANUP_API_KEY) raw.CLEANUP_API_KEY = decryptSecret(raw.CLEANUP_API_KEY);
    settingsCache = raw;
  }
  catch { settingsCache = {}; }
  return settingsCache;
}

function saveSettings(settings) {
  settingsCache = settings; // cache stays plaintext for app use
  // Encrypt keys at rest so a leaked settings.json doesn't expose API keys
  const toWrite = {
    ...settings,
    TRANSCRIPTION_API_KEY: settings.TRANSCRIPTION_API_KEY ? encryptSecret(settings.TRANSCRIPTION_API_KEY) : '',
    CLEANUP_API_KEY: settings.CLEANUP_API_KEY ? encryptSecret(settings.CLEANUP_API_KEY) : ''
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toWrite, null, 2), 'utf8');
}

function getEffectiveSetting(key) {
  const settings = loadSettings();
  // Explicit settings (including empty string) take priority over .env
  if (key in settings) return settings[key];
  return process.env[key] || '';
}

// --- API key encryption at rest ---
// Keys are stored in settings.json encrypted with AES-256-GCM. The encryption
// key is derived from the random session secret, so reading settings.json alone
// is not enough to recover API keys. If the session secret is ever recreated
// (e.g. data/ wiped), stored keys can no longer be decrypted — the user simply
// re-enters them in Settings.
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

function isOwnerSetup() { return fs.existsSync(HASH_FILE); }
function getOwnerHash() {
  if (!fs.existsSync(HASH_FILE)) return null;
  return fs.readFileSync(HASH_FILE, 'utf8').trim();
}

function isAuthenticated(req) {
  const token = req.signedCookies && req.signedCookies.session;
  if (!token) return false;
  const parts = token.split(':');
  if (parts.length !== 2) return false;
  const [timestamp, hmac] = parts;
  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age > SESSION_MAX_AGE || age < 0) return false;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
  // timingSafeEqual throws if buffer lengths differ; guard against malformed tokens
  try {
    const hmacBuf = Buffer.from(hmac, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (hmacBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(hmacBuf, expectedBuf);
  } catch {
    return false;
  }
}

function createSessionToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
  return timestamp + ':' + hmac;
}

// --- Middleware ---
// Same-origin only; no CORS needed for a cookie-authenticated app
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(getSessionSecret()));

app.use((req, res, next) => { req.isOwner = isAuthenticated(req); next(); });

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
// Defaults are generous for a single user. Tune via settings.json
// (e.g. RATE_LIMIT_UPLOAD_MAX, RATE_LIMIT_UPLOAD_WINDOW_MS, RATE_LIMIT_CLEANUP_MAX,
// RATE_LIMIT_CLEANUP_WINDOW_MS) or the equivalent .env vars.
// Note: limiters are created once at startup — restart the server after changes.
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

// Max transcript length sent to cleanup APIs (protects API costs).
// Configurable via MAX_TRANSCRIPT_CHARS in settings.json or .env.
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
  const { password, confirm } = req.body;
  if (!password || password.length < 8) return res.redirect('/setup?error=short');
  if (password !== confirm) return res.redirect('/setup?error=mismatch');

  fs.writeFileSync(HASH_FILE, await bcrypt.hash(password, BCRYPT_ROUNDS), 'utf8');
  const token = createSessionToken();
  res.cookie('session', token, { signed: true, httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE });
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  if (req.isOwner) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', authLimiter, async (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  const { password } = req.body;
  const hash = getOwnerHash();
  if (!password || !hash) return res.redirect('/login?error=1');
  if (!(await bcrypt.compare(password, hash))) return res.redirect('/login?error=1');

  const token = createSessionToken();
  res.cookie('session', token, { signed: true, httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE });
  res.redirect('/');
});

app.post('/change-password', authLimiter, async (req, res) => {
  if (!isOwnerSetup()) return res.status(400).json({ error: 'No password set yet.' });
  const { currentPassword, newPassword, confirm } = req.body;
  if (!currentPassword || !newPassword || !confirm) return res.status(400).json({ error: 'All fields are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (newPassword !== confirm) return res.status(400).json({ error: 'New passwords do not match.' });

  const hash = getOwnerHash();
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) return res.status(400).json({ error: 'Current password is incorrect.' });

  fs.writeFileSync(HASH_FILE, await bcrypt.hash(newPassword, BCRYPT_ROUNDS), 'utf8');
  res.json({ ok: true });
});

app.get('/logout', (req, res) => { res.clearCookie('session'); res.redirect('/login'); });

// --- Protected main page ---
app.get('/', (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  if (!req.isOwner) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Settings API ---
app.get('/api/settings', requireOwner, (req, res) => {
  const s = loadSettings();
  res.json({
    transcriptionKey: s.TRANSCRIPTION_API_KEY ? '••••' + s.TRANSCRIPTION_API_KEY.slice(-4) : '',
    transcriptionUrl: s.TRANSCRIPTION_BASE_URL || '',
    transcriptionModel: s.TRANSCRIPTION_MODEL || '',
    transcriptionLanguage: s.TRANSCRIPTION_LANGUAGE || '',
    transcriptionHint: s.TRANSCRIPTION_PROMPT || '',
    cleanupKey: s.CLEANUP_API_KEY ? '••••' + s.CLEANUP_API_KEY.slice(-4) : '',
    cleanupUrl: s.CLEANUP_BASE_URL || '',
    cleanupModel: s.CLEANUP_MODEL || ''
  });
});

app.post('/api/settings', requireOwner, (req, res) => {
  const { transcriptionKey, transcriptionUrl, transcriptionModel, transcriptionLanguage, transcriptionHint, cleanupKey, cleanupUrl, cleanupModel } = req.body;
  const current = loadSettings();

  if (transcriptionKey) current.TRANSCRIPTION_API_KEY = transcriptionKey;
  if (transcriptionUrl !== undefined) current.TRANSCRIPTION_BASE_URL = transcriptionUrl;
  if (transcriptionModel !== undefined) current.TRANSCRIPTION_MODEL = transcriptionModel;
  if (transcriptionLanguage !== undefined) current.TRANSCRIPTION_LANGUAGE = transcriptionLanguage;
  if (transcriptionHint !== undefined) current.TRANSCRIPTION_PROMPT = transcriptionHint;
  if (cleanupKey) current.CLEANUP_API_KEY = cleanupKey;
  if (cleanupUrl !== undefined) current.CLEANUP_BASE_URL = cleanupUrl;
  if (cleanupModel !== undefined) current.CLEANUP_MODEL = cleanupModel;

  saveSettings(current);
  res.json({ ok: true });
});

// --- Prompts API ---
function loadPrompts() {
  if (promptsCache) return promptsCache;
  // Migrate legacy prompts.json from root to data/ if present
  if (!fs.existsSync(PROMPTS_FILE) && fs.existsSync(LEGACY_PROMPTS_FILE)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_PROMPTS_FILE, 'utf8'));
      fs.writeFileSync(PROMPTS_FILE, JSON.stringify(legacy, null, 2));
      fs.unlinkSync(LEGACY_PROMPTS_FILE);
      promptsCache = legacy;
      return promptsCache;
    } catch { promptsCache = []; return promptsCache; }
  }
  if (!fs.existsSync(PROMPTS_FILE)) { promptsCache = []; return promptsCache; }
  try { promptsCache = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); }
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

// --- Transcription & Cleanup ---
function getTranscriptionClient() {
  const key = getEffectiveSetting('TRANSCRIPTION_API_KEY');
  const baseURL = getEffectiveSetting('TRANSCRIPTION_BASE_URL');
  if (!key) throw new Error('Transcription API key not configured. Go to Settings tab.');
  return new OpenAI({ apiKey: key, baseURL: baseURL || undefined, timeout: AI_TIMEOUT_MS });
}

function getCleanupClient() {
  const key = getEffectiveSetting('CLEANUP_API_KEY');
  const baseURL = getEffectiveSetting('CLEANUP_BASE_URL');
  if (!key) throw new Error('Cleanup API key not configured. Go to Settings tab.');
  return new OpenAI({ apiKey: key, baseURL: baseURL || undefined, timeout: AI_TIMEOUT_MS });
}

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
// Removes orphaned audio files left behind if a request dies between multer
// writing the file and the route handler cleaning it up. Runs every 15 minutes
// and removes anything older than 30 minutes (safely above the 2-minute AI timeout).
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
setInterval(sweepStaleUploads, UPLOAD_SWEEP_INTERVAL_MS).unref(); // unref so the process can exit naturally

app.post('/upload', requireOwner, aiUploadLimiter, upload.single('audio'), uploadErrorHandler, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    const client = getTranscriptionClient();
    const model = getEffectiveSetting('TRANSCRIPTION_MODEL') || 'whisper-1';
    const language = getEffectiveSetting('TRANSCRIPTION_LANGUAGE');
    const hint = getEffectiveSetting('TRANSCRIPTION_PROMPT');
    const audioPath = req.file.path;

    const params = { file: fs.createReadStream(audioPath), model };
    // Optional params are only sent when configured — keeps requests identical
    // to before for providers that reject unknown fields
    if (language) params.language = language;
    if (hint) params.prompt = hint;

    const transcription = await client.audio.transcriptions.create(params);

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.json({ rawTranscript: transcription.text });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Upload error:', error.message);
    // Distinguish 413 (from reverse proxy) from other errors
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
});

// --- Live transcription chunk (used by Live mode) ---
// Live mode sends a ~3s WAV chunk every 3 seconds while recording, so it needs a
// much higher rate limit than the main /upload (which is capped at 40/15min).
const aiChunkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500, // ~3s chunks → up to ~75 min of continuous live recording per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many transcription requests — please try again in a moment.'
});

app.post('/upload-chunk', requireOwner, aiChunkLimiter, upload.single('audio'), uploadErrorHandler, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio received' });
    const client = getTranscriptionClient();
    const model = getEffectiveSetting('TRANSCRIPTION_MODEL') || 'whisper-1';
    const language = getEffectiveSetting('TRANSCRIPTION_LANGUAGE');
    const hint = getEffectiveSetting('TRANSCRIPTION_PROMPT');
    const audioPath = req.file.path;

    const params = { file: fs.createReadStream(audioPath), model };
    if (language) params.language = language;
    if (hint) params.prompt = hint;

    const transcription = await client.audio.transcriptions.create(params);

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.json({ rawTranscript: transcription.text });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Chunk upload error:', error.message);
    const status = error.status || 500;
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
    const model = getEffectiveSetting('CLEANUP_MODEL') || 'gpt-4.1-mini';
    const activePrompt = prompt || 'Clean up dictated text.';

    const cleanup = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: activePrompt },
        { role: 'user', content: `<transcript>${rawTranscript}</transcript>` }
      ]
    });

    res.json({ cleanedTranscript: cleanup.choices[0].message.content });
  } catch (error) {
    console.error('Cleanup error:', error.message);
    const status = error.status || 500;
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
    const model = getEffectiveSetting('CLEANUP_MODEL') || 'gpt-4.1-mini';
    const activePrompt = prompt || 'Clean up dictated text.';

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx proxy buffering off
    res.flushHeaders();

    const stream = await client.chat.completions.create({
      model,
      temperature: 0,
      stream: true,
      messages: [
        { role: 'system', content: activePrompt },
        { role: 'user', content: `<transcript>${rawTranscript}</transcript>` }
      ]
    });

    let aborted = false;
    req.on('close', () => { aborted = true; });

    for await (const chunk of stream) {
      if (aborted) break;
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
    res.end();
  } catch (error) {
    console.error('Streaming cleanup error:', error.message);
    // If headers already sent, send error as SSE event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      const status = error.status || 500;
      res.status(status).json({ error: error.message });
    }
  }
});
// --- Static files (AFTER all API routes) ---
app.use((req, res, next) => {
  // Public paths that don't need auth
  const publicPaths = ['/login.html', '/setup.html', '/auth.css', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/sw.js'];
  if (publicPaths.includes(req.path)) return express.static(path.join(__dirname, 'public'))(req, res, next);
  if (!req.isOwner) return res.status(401).send('Unauthorized');
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
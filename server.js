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
  try { settingsCache = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { settingsCache = {}; }
  return settingsCache;
}

function saveSettings(settings) {
  settingsCache = settings;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function getEffectiveSetting(key) {
  const settings = loadSettings();
  // Explicit settings (including empty string) take priority over .env
  if (key in settings) return settings[key];
  return process.env[key] || '';
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

app.post('/upload', requireOwner, upload.single('audio'), uploadErrorHandler, async (req, res) => {
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

app.post('/cleanup', requireOwner, async (req, res) => {
  try {
    const { rawTranscript, prompt } = req.body;
    if (!rawTranscript) return res.status(400).json({ error: 'No transcript' });

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
app.post('/cleanup-stream', requireOwner, async (req, res) => {
  try {
    const { rawTranscript, prompt } = req.body;
    if (!rawTranscript) return res.status(400).json({ error: 'No transcript' });

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
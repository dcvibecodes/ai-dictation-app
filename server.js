require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const cookieParser = require('cookie-parser');
const OpenAI  = require('openai');

const app    = express();
const upload = multer({ dest: 'uploads/' });
const PORT   = process.env.PORT || 3000;

// --- Config ---
const DATA_DIR      = path.join(__dirname, 'data');
const HASH_FILE     = path.join(DATA_DIR, 'owner.hash');
const SECRET_FILE   = path.join(DATA_DIR, 'session.secret');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PROMPTS_FILE  = path.join(__dirname, 'prompts.json');
const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Settings (API config) ---
function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function getEffectiveSetting(key) {
  const settings = loadSettings();
  // Settings UI values take priority over .env
  return settings[key] || process.env[key] || '';
}

// --- Auth ---
function getSessionSecret() {
  if (!fs.existsSync(SECRET_FILE)) {
    const secret = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, 'utf8');
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
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
  return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'));
}

function createSessionToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', getSessionSecret()).update(timestamp).digest('hex');
  return timestamp + ':' + hmac;
}

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(getSessionSecret()));

app.use((req, res, next) => { req.isOwner = isAuthenticated(req); next(); });

function requireOwner(req, res, next) {
  if (!req.isOwner) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// --- Auth Routes ---
app.get('/setup', (req, res) => {
  if (isOwnerSetup()) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.post('/setup', async (req, res) => {
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

app.post('/login', async (req, res) => {
  if (!isOwnerSetup()) return res.redirect('/setup');
  const { password } = req.body;
  const hash = getOwnerHash();
  if (!password || !hash) return res.redirect('/login?error=1');
  if (!(await bcrypt.compare(password, hash))) return res.redirect('/login?error=1');

  const token = createSessionToken();
  res.cookie('session', token, { signed: true, httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE });
  res.redirect('/');
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
    cleanupKey: s.CLEANUP_API_KEY ? '••••' + s.CLEANUP_API_KEY.slice(-4) : '',
    cleanupUrl: s.CLEANUP_BASE_URL || '',
    cleanupModel: s.CLEANUP_MODEL || ''
  });
});

app.post('/api/settings', requireOwner, (req, res) => {
  const { transcriptionKey, transcriptionUrl, transcriptionModel, cleanupKey, cleanupUrl, cleanupModel } = req.body;
  const current = loadSettings();

  if (transcriptionKey) current.TRANSCRIPTION_API_KEY = transcriptionKey;
  if (transcriptionUrl !== undefined) current.TRANSCRIPTION_BASE_URL = transcriptionUrl;
  if (transcriptionModel !== undefined) current.TRANSCRIPTION_MODEL = transcriptionModel;
  if (cleanupKey) current.CLEANUP_API_KEY = cleanupKey;
  if (cleanupUrl !== undefined) current.CLEANUP_BASE_URL = cleanupUrl;
  if (cleanupModel !== undefined) current.CLEANUP_MODEL = cleanupModel;

  saveSettings(current);
  res.json({ ok: true });
});

// --- Prompts API ---
function loadPrompts() {
  if (!fs.existsSync(PROMPTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); }
  catch { return []; }
}
function savePrompts(prompts) { fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2)); }

app.get('/prompts', requireOwner, (req, res) => { res.json(loadPrompts()); });

app.post('/prompts', requireOwner, (req, res) => {
  const { id, name, text } = req.body;
  if (!id || !name || !text) return res.status(400).json({ error: 'id, name and text required' });
  const prompts = loadPrompts();
  const idx = prompts.findIndex(p => p.id === id);
  if (idx >= 0) { prompts[idx] = { id, name, text }; }
  else {
    if (prompts.length >= 4) return res.status(400).json({ error: 'Max 4 prompts' });
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
  return new OpenAI({ apiKey: key, baseURL: baseURL || undefined });
}

function getCleanupClient() {
  const key = getEffectiveSetting('CLEANUP_API_KEY');
  const baseURL = getEffectiveSetting('CLEANUP_BASE_URL');
  if (!key) throw new Error('Cleanup API key not configured. Go to Settings tab.');
  return new OpenAI({ apiKey: key, baseURL: baseURL || undefined });
}

app.post('/upload', requireOwner, upload.single('audio'), async (req, res) => {
  try {
    const client = getTranscriptionClient();
    const model = getEffectiveSetting('TRANSCRIPTION_MODEL') || 'whisper-1';
    const audioPath = req.file.path;

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model
    });

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.json({ rawTranscript: transcription.text });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Upload error:', error.message);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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

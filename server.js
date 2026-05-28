require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const OpenAI  = require('openai');

const app    = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const PROMPTS_FILE = path.join(__dirname, 'prompts.json');

function loadPrompts() {
  if (!fs.existsSync(PROMPTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8')); }
  catch { return []; }
}

function savePrompts(prompts) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
}

// GET all custom prompts
app.get('/prompts', (req, res) => {
  res.json(loadPrompts());
});

// POST save or update a prompt
app.post('/prompts', (req, res) => {
  const { id, name, text } = req.body;
  if (!id || !name || !text) return res.status(400).json({ error: 'id, name and text are required' });
  const prompts = loadPrompts();
  const existing = prompts.findIndex(p => p.id === id);
  if (existing >= 0) {
    prompts[existing] = { id, name, text };
  } else {
    if (prompts.length >= 4) return res.status(400).json({ error: 'Maximum 4 custom prompts reached' });
    prompts.push({ id, name, text });
  }
  savePrompts(prompts);
  res.json({ ok: true });
});

// DELETE a prompt
app.delete('/prompts/:id', (req, res) => {
  const prompts = loadPrompts().filter(p => p.id !== req.params.id);
  savePrompts(prompts);
  res.json({ ok: true });
});

const transcriptionClient = new OpenAI({
  apiKey:   process.env.TRANSCRIPTION_API_KEY,
  baseURL:  process.env.TRANSCRIPTION_BASE_URL || undefined
});

const cleanupClient = new OpenAI({
  apiKey:   process.env.CLEANUP_API_KEY,
  baseURL:  process.env.CLEANUP_BASE_URL || undefined
});

// Step 1 — upload audio and transcribe only, return raw text
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const audioPath = req.file.path;

    const transcription = await transcriptionClient.audio.transcriptions.create({
      file:  fs.createReadStream(audioPath),
      model: process.env.TRANSCRIPTION_MODEL || 'whisper-1'
    });

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    res.json({ rawTranscript: transcription.text });

  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Upload error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Step 2 — receive raw text + prompt as JSON, return cleaned text
app.post('/cleanup', async (req, res) => {
  try {
    const { rawTranscript, prompt } = req.body;

    if (!rawTranscript) return res.status(400).json({ error: 'No transcript provided' });

    const activePrompt = prompt || process.env.CLEANUP_PROMPT || 'Clean up dictated text.';

    console.log('Using prompt:', activePrompt.slice(0, 80) + '...');

    const cleanup = await cleanupClient.chat.completions.create({
      model:       process.env.CLEANUP_MODEL || 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: activePrompt },
        { role: 'user',   content: `<transcript>${rawTranscript}</transcript>` }
      ]
    });

    res.json({ cleanedTranscript: cleanup.choices[0].message.content });

  } catch (error) {
    console.error('Cleanup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

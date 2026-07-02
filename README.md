# Dictation Tool

A password-protected dictation app that records your voice, transcribes it, and cleans up the transcript using AI. No `.env` file required — configure everything from the UI.

---

## How It Works

1. **Transcription** — audio is sent to a speech-to-text model (Whisper, Voxtral, etc.)
2. **Cleanup** — raw text is processed by a language model with a configurable system prompt that fixes grammar, punctuation, filler words, and formats into paragraphs

The result is auto-copied to your clipboard.

---

## Getting Started

```bash
cd dictation-app
npm install
npm start
```

Open `http://localhost:3000`. First visit: set your owner password. Then go to Settings and enter your API keys.

No `.env` file needed. All configuration lives in the UI.

---

## Features

- **Password-protected** — owner-only access, bcrypt hashed, 7-day session
- **Dictate tab** — record, transcribe, and clean up in one flow
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Multiple cleanup prompts** — create up to 4 custom prompts, switch instantly
- **History tab** — persistent session history (localStorage, 20 entries), restore or copy any past transcription
- **Settings tab** — configure API keys, base URLs, models, and manage prompts all in one place
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Dark/light theme** — respects system preference on login, toggleable in-app
- **Keyboard shortcuts** — `S` start/stop, `C` cancel, `Escape` close modals
- **Auto-copy** — cleaned transcript copied to clipboard automatically
- **Works with any provider** — Mistral, OpenAI, Grok, Gemini, or any compatible API

---

## Tabs

| Tab | Purpose |
|---|---|
| Dictate | Record, transcribe, clean up, copy |
| History | View/restore/copy past transcriptions |
| Settings | API keys, models, base URLs, cleanup prompts |

---

## Authentication

- First visit → `/setup` to create a password (min 8 characters)
- Subsequent visits → `/login`
- 7-day session cookie
- All API routes protected
- To reset password: delete `data/owner.hash` and restart

---

## Project Structure

```
dictation-app/
├── public/
│   ├── index.html       # Main app (3 tabs)
│   ├── login.html       # Login page
│   ├── setup.html       # First-time setup
│   ├── auth.css         # Auth page styles
│   ├── script.js        # Frontend logic
│   └── styles.css       # Main styles
├── data/                # Auto-created, gitignored
│   ├── owner.hash       # Password hash
│   ├── session.secret   # HMAC secret
│   └── settings.json    # API keys & config
├── uploads/             # Temp audio (auto-deleted)
├── prompts.json         # Custom prompts
├── server.js            # Express backend
├── package.json
└── .gitignore
```

---

## API Configuration

Configure from the Settings tab. Supports any provider with an OpenAI-compatible API format:

| Field | Example |
|---|---|
| Transcription API Key | `sk-...` or Mistral key |
| Transcription Base URL | `https://api.mistral.ai/v1` (blank = OpenAI default) |
| Transcription Model | `whisper-1`, `voxtral-mini-latest` |
| Cleanup API Key | `sk-...` |
| Cleanup Base URL | blank for OpenAI, or provider URL |
| Cleanup Model | `gpt-4.1-mini`, `mistral-large-latest` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Inter font |
| Backend | Node.js, Express |
| Auth | bcryptjs, cookie-parser, HMAC sessions |
| AI | Any OpenAI-compatible speech-to-text + chat API |
| Audio | Web Audio API, MediaRecorder |

---

## Notes

- No `.env` file required — configure everything from Settings tab
- Audio temp files deleted immediately after transcription
- Session history is browser-side (localStorage)
- API keys stored in `data/settings.json` (gitignored)
- Prompts stored in `prompts.json`
- The `data/` directory is auto-created on first run and fully gitignored

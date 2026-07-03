# Dictation Tool

A password-protected dictation PWA that records your voice, transcribes it, and cleans up the transcript using AI. No `.env` file required — configure everything from the UI. Installable as a standalone app on any device.

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

## Install as App (PWA)

Since this is a Progressive Web App, you can install it as a standalone window — no app store, no admin rights needed:

1. Open the app in Chrome/Edge
2. Click the install icon in the address bar (or three-dot menu → "Install app")
3. It appears in your taskbar/start menu and opens in its own window

Works on desktop and mobile. Ideal for work computers where you can't install software.

---

## Features

- **Installable PWA** — runs as a standalone app window, no browser chrome
- **Password-protected** — owner-only access, bcrypt hashed, 7-day session
- **Dictate tab** — record, transcribe, and clean up in one flow
- **Frequency bar waveform** — live audio visualization while recording
- **Auto-clean toggle** — skip cleanup when you just want raw text
- **Multiple cleanup prompts** — up to 4 custom prompts, switch instantly
- **History tab** — persistent session history (localStorage, 20 entries)
- **Settings tab** — API keys, models, base URLs, and prompt management
- **Locked settings** — API config is read-only by default, click Edit to modify
- **Dark/light theme** — toggleable, login page respects system preference
- **Keyboard shortcuts** — `S` start/stop, `C` cancel/clear/abort, `Escape` close modals
- **Auto-copy** — transcript copied to clipboard automatically
- **Local backup** — recording saved to IndexedDB on stop (with in-memory fallback); retry, download, or clear from the recovery strip if upload fails
- **Any provider** — works with Mistral, OpenAI, Grok, Gemini, or any compatible API
- **In-memory audio fallback** — if IndexedDB is unavailable (private browsing), audio is kept in memory as a safety net
- **Smart recovery row** — only appears when transcription/upload fails, not on cleanup failure; raw transcript stays on screen
- **Upload audio files** — supports MP3, WAV, OGG, WebM, M4A, FLAC, AAC up to 50 MB
- **Comprehensive Settings help** — collapsible troubleshooting guide covering all error states, local storage, keyboard shortcuts, and offline usage
- **Stronger button feedback** — visual glow ring on press for instant tap confirmation
- **Draggable recorder bar (mobile)** — touch anywhere (except buttons) to reposition the bar; position persisted across sessions
- **Custom checkbox styling** — monochrome, visible in both themes without using accent colors
- **Improved dark theme contrast** — recorder card border adjusted for clear visibility in dark mode

---

## Tabs

| Tab | Purpose |
|---|---|
| Dictate | Record, transcribe, clean up, copy |
| History | View/restore/copy past transcriptions |
| Settings | API config + cleanup prompt management |

---

## Authentication

- First visit → `/setup` to create a password (min 8 characters)
- Subsequent visits → `/login`
- 7-day session cookie
- All API routes protected
- To reset password: delete `data/owner.hash` and restart

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Start/stop recording |
| `C` | Cancel recording / abort processing / clear text |
| `Escape` | Close modal |

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
│   ├── styles.css       # Main styles
│   ├── sw.js            # Service worker (PWA)
│   ├── manifest.json    # PWA manifest
│   ├── favicon.svg      # App icon
│   ├── icon-192.png     # PWA icon
│   └── icon-512.png     # PWA icon
├── data/                # Auto-created, gitignored
│   ├── owner.hash       # Password hash
│   ├── session.secret   # HMAC secret
│   └── settings.json    # API keys & config
├── uploads/             # Temp audio (auto-deleted)
├── prompts.json         # Custom prompts
├── server.js            # Express backend
├── generate-icons.js    # Icon generator (run once)
├── package.json
└── .gitignore
```

---

## API Configuration

Configure from the Settings tab. Works with any provider that uses the same API format:

| Field | Example |
|---|---|
| Transcription API Key | Mistral key, OpenAI key, etc. |
| Transcription Base URL | `https://api.mistral.ai/v1` (required for non-OpenAI) |
| Transcription Model | `whisper-1`, `voxtral-mini-latest` |
| Cleanup API Key | Your provider's key |
| Cleanup Base URL | Provider URL (blank = OpenAI) |
| Cleanup Model | `gpt-4.1-mini`, `mistral-large-latest` |

The base URL must match the provider that issued the key.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, Inter font, PWA |
| Backend | Node.js, Express |
| Auth | bcryptjs, cookie-parser, HMAC sessions |
| AI | Any compatible speech-to-text + chat API |
| Audio | Web Audio API, MediaRecorder |

---

## Notes

- No `.env` file required — all config via Settings tab
- Audio temp files deleted immediately after transcription
- Session history is browser-side (localStorage)
- API keys stored in `data/settings.json` (gitignored)
- `data/` directory auto-created on first run, fully gitignored
- PWA works offline for the UI shell; recording requires network for AI APIs

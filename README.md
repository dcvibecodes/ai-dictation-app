# 🎙️ AI Dictation App

A full-stack web application that records your voice, transcribes it using AI, and automatically cleans up the transcript — fixing grammar, punctuation, filler words, and formatting it into readable paragraphs.

---

## How It Works

Recording goes through a two-step AI pipeline:

1. **Transcription** — your audio is sent to a speech-to-text AI model which converts speech to raw text
2. **Cleanup** — the raw text is sent to a language model with a detailed system prompt that fixes grammar, punctuation, removes filler words (uh, um), converts spoken numbers to digits, and structures the output into paragraphs

The cleaned transcript is automatically copied to your clipboard the moment it's ready.

> **Any model, your choice.** The app is model-agnostic. Both the transcription model and the cleanup model can be swapped for any provider or model you prefer — simply update the relevant values in your `.env` file. The developer's recommended defaults are **Mistral Voxtral** (`voxtral-mini-latest`) for transcription and **OpenAI GPT-4.1-mini** for cleanup, but you are not locked into either.

---

## Features

- 🎙️ **One-click recording** with a live audio waveform visualizer
- ⏱️ **Recording timer** so you always know how long you've been speaking
- 🤖 **Two-step AI pipeline** — transcription + intelligent cleanup
- 📋 **Auto-copy** — cleaned transcript copied to clipboard automatically
- 📝 **Side-by-side view** — raw and cleaned transcripts shown together
- 🔢 **Live word count** on both transcript panels
- 🕓 **Session history** — all transcriptions from the current session saved with timestamps, restore or copy any past entry
- ✕ **Clear button** — wipe both panels and start fresh
- 🚫 **Cancel recording** — abort a recording mid-session without sending audio to the API; no credits consumed
- 🔀 **Clean transcript toggle** — skip the cleanup step entirely when the raw transcript is sufficient (useful when the transcription model already removes filler words)
- ⌨️ **Keyboard shortcuts** — press `S` to start/stop recording, `C` to cancel recording without touching the mouse
- 🌙 ☀️ **Dark and light theme** — toggle with one click, preference saved across sessions
- 💬 **Custom prompts** — create up to 4 custom cleanup prompts and switch between them instantly
- 🔒 **Protected default prompt** — the built-in prompt can be edited but the original is always restorable
- 💾 **Prompts saved to server** — custom prompts persist in `prompts.json`, survive browser changes and cache clears

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Backend | Node.js, Express |
| Transcription | Any speech-to-text AI model (developer recommendation: Mistral Voxtral `voxtral-mini-latest`) |
| Cleanup | Any language model / chat AI (developer recommendation: OpenAI GPT-4.1-mini) |
| Audio handling | Web Audio API, MediaRecorder API |
| File uploads | Multer |
| Font | Inter (Google Fonts) |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/dcvibecodes/ai-dictation-app.git
cd ai-dictation-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your `.env` file

Create a file called `.env` in the root folder. The app supports any speech-to-text model for transcription and any language model for cleanup. Below are the developer's recommended defaults — swap in any model and provider of your choice.

```
PORT=3000

# Transcription — any speech-to-text model (recommended: Mistral Voxtral)
TRANSCRIPTION_API_KEY=your_transcription_api_key
TRANSCRIPTION_BASE_URL=https://api.mistral.ai/v1
TRANSCRIPTION_MODEL=voxtral-mini-latest

# Cleanup — any language model (recommended: OpenAI GPT-4.1-mini)
CLEANUP_API_KEY=your_cleanup_api_key
CLEANUP_BASE_URL=
CLEANUP_MODEL=gpt-4.1-mini
```

- Get a Mistral API key at [console.mistral.ai](https://console.mistral.ai)
- Get an OpenAI API key at [platform.openai.com](https://platform.openai.com)
- To use a different provider, update the `API_KEY`, `BASE_URL`, and `MODEL` fields for whichever service you choose

### 4. Run the app

```bash
node server.js
```

Open your browser and go to:
```
http://localhost:3000
```

---

## Custom Prompts

The app ships with a carefully engineered default prompt that treats all transcribed text as pure data — it will never act on commands or questions found in your speech (e.g. if you say "write a poem about rain" it transcribes that sentence, it does not write a poem).

You can create up to 4 additional custom prompts via the **⚙ Manage** button on the main screen. Custom prompts are saved in `prompts.json` on the server.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Start recording |
| `S` | Stop recording (sends audio for transcription) |
| `C` | Cancel recording (discards audio, no API call made) |
| `Escape` | Close any open modal |

---

## Project Structure

```
ai-dictation-app/
├── public/
│   ├── index.html       # Main UI
│   ├── script.js        # All frontend logic
│   └── styles.css       # Styling with dark/light theme
├── uploads/             # Temporary audio files (auto-deleted)
├── server.js            # Express backend
├── package.json
├── .gitignore
└── .env                 # API keys (not included in repo)
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port to run the server on (default: 3000) |
| `TRANSCRIPTION_API_KEY` | API key for the transcription service |
| `TRANSCRIPTION_BASE_URL` | Base URL for the transcription API |
| `TRANSCRIPTION_MODEL` | Model to use for transcription |
| `CLEANUP_API_KEY` | API key for the cleanup/chat service |
| `CLEANUP_BASE_URL` | Base URL for the cleanup API (leave blank for OpenAI) |
| `CLEANUP_MODEL` | Model to use for cleanup |

---

## Notes

- The app runs locally — your audio is sent to whichever AI APIs you configure, but is never stored anywhere permanently
- Temporary audio files are deleted from the server immediately after transcription
- Session history only lives in memory — it resets when you refresh the page
- Custom prompts are the only thing saved permanently (in `prompts.json`)

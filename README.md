# Orgainizer

AI-powered personal calendar assistant ("Orgainizer") that connects to your Google Calendar, answers natural language questions, summarizes schedules, and performs event actions (create / update / delete) with AI assistance.

## Features
* Google OAuth sign-in (token passed via custom `token` header)
* Fetch & cache calendar events in time windows (auto AI range inference)
* Natural language Q&A about your schedule (streaming responses via Server-Sent Events)
* AI action extraction (batch create / delete / update events)
* Timezone-aware reasoning (client can send `x-timezone` header)
* Text-to-Speech (on-demand or streaming) using Gemini models
* Voice input: record short audio, automatic silence detection, transcription to text, optional auto-send
* Heuristic + AI hybrid date range selection (fallback if AI unavailable)
* Netlify function deployment (serverless) or local Express dev server

## Tech Stack
Frontend: React 19, FullCalendar, React Markdown (GFM), SSE streaming
Backend: Node + Express (TypeScript), Google Calendar API, Google Gemini (`@google/genai`)
Deployment: Netlify build + Functions wrapper (`serverless-http`)

## Quick Start (Local Dev)
1. Clone repository
2. Create an `.env` file in project root with required environment variables (see below)
3. Install dependencies:
	```bash
	npm run setup
	```
4. Start concurrent dev servers (React on 3000, API on 3001):
	```bash
	npm run dev
	```
5. Open http://localhost:3000 and sign in with Google.

## Environment Variables
Create a `.env` file (not committed) containing:

| Variable | Description | Required |
|----------|-------------|----------|
| PORT | API port for local Express server (default 3001) | No |
| GOOGLE_CLIENT_ID | OAuth client ID from Google Cloud Console | Yes |
| GOOGLE_CLIENT_SECRET | OAuth client secret | Yes |
| REDIRECT_URI | OAuth redirect URI (e.g. http://localhost:3000) matching console config | Yes |
| GEMINI_API_KEY | Google AI Studio / Gemini API key | Yes |
| GEMINI_REALTIME_MODEL | Gemini model name used for text / actions generation (e.g. `models/gemini-1.5-flash`) | Yes |
| GEMINI_TTS_MODEL | Gemini model used for TTS audio generation (e.g. `models/gemini-1.5-flash`) | Yes |

Optional additional environment notes:
* Netlify injects its own build variables; replicate above keys in Netlify dashboard for production.

## Frontend Dev Scripts
| Command | Purpose |
|---------|---------|
| `npm run setup` | Install packages (legacy peer deps) |
| `npm run dev` | Run React + API concurrently |
| `npm run start` | React dev server only |
| `npm run server:dev` | API only (nodemon + ts-node) |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm run build` | Production React build |
| `npm run netlify:dev` | Simulated Netlify environment |

## How It Works
1. User authenticates with Google -> frontend stores access token (not persisted server-side).
2. Each API request includes `token` header; middleware validates via Google token info, caching expiry.
3. When user asks a question, frontend:
	* Calls `/assistant/range` for minimal date ranges (AI + heuristics) to scope calendar fetch.
	* Fetches events for inferred window (or uses cached windows) through `/calendar/events`.
	* Streams AI response from `/assistant/stream` (SSE). The backend prompt includes current events and conversation context.
	* Streams incremental Text-to-Speech segments (optional) using `/assistant/tts/stream` for near real-time playback.
4. AI may emit structured action JSON; backend parses and executes calendar operations (batch optimizing create/delete) and appends confirmation lines to the assistant response.
5. User can trigger TTS generation for any assistant message or record voice to transcribe into a query.

### Timezone Handling
Frontend should send `x-timezone: <IANA TZ>` (e.g. `America/New_York`) so prompts and event creation use correct local interpretation. Backend falls back to system timezone or UTC.

### Event Actions
Supported AI actions:
* create_event
* update_event
* delete_event (instance or series scope)
The backend safeguards by limiting recurrence count and requiring essential fields.

## API Overview
| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/auth/google` | GET | OAuth start URL |
| `/api/auth/google/callback` | GET | OAuth redirect handler |
| `/api/auth/me` | GET | Current user profile (requires `token`) |
| `/api/calendar/events` | GET | Query via `start`, `end`, or `months` |
| `/api/calendar/events` | POST | Create single or array of events |
| `/api/calendar/events/:id` | PUT | Patch event |
| `/api/calendar/events/:id` | DELETE | Delete event |
| `/api/calendar/events/batch-delete` | POST | Delete multiple events |
| `/api/assistant/range` | POST | AI date range inference |
| `/api/assistant/stream` | POST | Streaming assistant reply + actions |
| `/api/assistant/tts` | POST | Full TTS (base64) |
| `/api/assistant/tts/stream` | POST | Streaming PCM chunks -> client WebAudio |
| `/api/assistant/transcribe` | POST | Audio transcription |

Headers:
* `token`: Google access token (required for all protected endpoints)
* `x-timezone`: User timezone (recommended)

## Deployment (Netlify)
1. Set environment variables in Netlify dashboard.
2. Deploy: Netlify runs `npm run build` and serves from `build/` with functions in `netlify/functions`.
3. API requests are proxied via redirects to the serverless function bundling Express.

## Security Notes
* Access token only validated server-side; not stored beyond in-memory cache.
* AI prompts instruct model not to reveal internal instructions.
* Range queries capped (18 months logical, 24 months absolute safety) to avoid large data pulls.

## Future Enhancements (Ideas)
* Add unit tests for heuristic range builder & action parsing
* Persist minimal user session metadata (preferred voice, last ranges) locally
* Support event conflict suggestions or free-time search
* Add pagination / incremental loading for very large calendars
* Integrate vector store for richer long-term memory (opt-in)

## Troubleshooting
| Issue | Suggestion |
|-------|------------|
| AI replies lack actions | Ensure `GEMINI_REALTIME_MODEL` correct & key valid |
| TTS muted | Toggle mute button (🔊 / 🔇) or ensure browser autoplay policies satisfied |
| Token invalid errors | Re-authenticate; token may have expired |
| Wrong timezone interpretation | Confirm `x-timezone` header being sent |

---
Happy scheduling!

## Authors
George Pauer (<georgep@bbd.co.za>)  
Bradleigh Marks (<bradm@bbd.co.za>)

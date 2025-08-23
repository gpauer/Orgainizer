import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';

import { createCalendarEvents, deleteCalendarEvent, getCalendarEvents, updateCalendarEvent } from './api/calendar';
import { requireValidTokenFactory } from './api/middleware';
import { assistantQueryHandler, assistantRangeHandler, assistantStreamHandler, assistantTTSHandler, assistantTranscribeHandler, assistantTTSStreamHandler } from './api/assistantHandlers';
import { googleAuthUrlHandler, googleAuthCallbackHandler } from './api/authHandlers';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, GEMINI_API_KEY, PORT } = process.env as Record<string, string>;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !REDIRECT_URI) console.warn('Google OAuth environment variables are missing.');
if (!GEMINI_API_KEY) console.warn('GEMINI_API_KEY missing. AI features will fail.');

const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const requireValidToken = requireValidTokenFactory(oAuth2Client);

// Auth
app.get('/api/auth/google', googleAuthUrlHandler(oAuth2Client));
app.get('/api/auth/google/callback', googleAuthCallbackHandler(oAuth2Client));

// Calendar
app.get('/api/calendar/events', requireValidToken, (req, res) => getCalendarEvents(req, res, oAuth2Client));
app.post('/api/calendar/events', requireValidToken, (req, res) => createCalendarEvents(req, res, oAuth2Client));
app.put('/api/calendar/events/:id', requireValidToken, (req, res) => updateCalendarEvent(req, res, oAuth2Client));
app.delete('/api/calendar/events/:id', requireValidToken, (req, res) => deleteCalendarEvent(req, res, oAuth2Client));

// Assistant
app.post('/api/assistant/query', requireValidToken, assistantQueryHandler(ai));
app.post('/api/assistant/range', requireValidToken, assistantRangeHandler(ai));
app.post('/api/assistant/stream', requireValidToken, assistantStreamHandler(ai));
app.post('/api/assistant/tts', requireValidToken, assistantTTSHandler(ai));
app.post('/api/assistant/transcribe', requireValidToken, assistantTranscribeHandler(ai));
app.post('/api/assistant/tts/stream', requireValidToken, assistantTTSStreamHandler(ai));

const port = PORT || '3001';
app.listen(port, () => console.log(`Server running on port ${port}`));

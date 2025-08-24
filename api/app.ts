import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { createCalendarEvents, deleteCalendarEvent, deleteCalendarEventsBatch, getCalendarEvents, updateCalendarEvent } from './calendar';
import { assistantRangeHandler, assistantStreamHandler, assistantTTSHandler, assistantTranscribeHandler, assistantTTSStreamHandler } from './assistantHandlers';
import { googleAuthUrlHandler, googleAuthCallbackHandler } from './authHandlers';
import { requireValidTokenFactory } from './middleware';

dotenv.config();

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, GEMINI_API_KEY } = process.env as Record<string,string|undefined>;
  const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const requireValidToken = requireValidTokenFactory(oAuth2Client);
  
  // Auth
  app.get('/api/auth/google', googleAuthUrlHandler(oAuth2Client));
  app.get('/api/auth/google/callback', googleAuthCallbackHandler(oAuth2Client));
  // Current user info (Google profile) - requires valid access token
  app.get('/api/auth/me', requireValidToken, async (req, res) => {
    try {
      const token = req.headers['token'] as string;
      if (!token) return res.status(401).json({ error: 'Missing token' });
      const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }, timeout: 5000
      });
      const user = {
        email: data.email,
        displayName: data.name,
        profilePicture: data.picture,
        givenName: data.given_name,
        familyName: data.family_name,
        locale: data.locale
      };
      res.json(user);
    } catch (e: any) {
      const status = e.response?.status || 500;
      res.status(status).json({ error: 'Failed to retrieve user info' });
    }
  });
  
  // Calendar
  app.get('/api/calendar/events', requireValidToken, (req, res) => getCalendarEvents(req, res, oAuth2Client));
  app.post('/api/calendar/events', requireValidToken, (req, res) => createCalendarEvents(req, res, oAuth2Client));
  app.put('/api/calendar/events/:id', requireValidToken, (req, res) => updateCalendarEvent(req, res, oAuth2Client));
  app.delete('/api/calendar/events/:id', requireValidToken, (req, res) => deleteCalendarEvent(req, res, oAuth2Client));
  app.post('/api/calendar/events/batch-delete', requireValidToken, (req, res) => deleteCalendarEventsBatch(req, res, oAuth2Client));
  
  // Assistant
  app.post('/api/assistant/range', requireValidToken, assistantRangeHandler(ai));
  app.post('/api/assistant/stream', requireValidToken, assistantStreamHandler(ai));
  app.post('/api/assistant/tts', requireValidToken, assistantTTSHandler(ai));
  app.post('/api/assistant/transcribe', requireValidToken, assistantTranscribeHandler(ai));
  app.post('/api/assistant/tts/stream', requireValidToken, assistantTTSStreamHandler(ai));

  return app;
}

export function handlerless() { return createApp(); }

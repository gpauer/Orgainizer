import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from "@google/genai";

import { google } from 'googleapis';

import { getCalendarEvents } from './api/calendar';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Ensure required env vars
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
  GEMINI_API_KEY,
  PORT
} = process.env as Record<string, string>;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !REDIRECT_URI) {
  console.warn('Google OAuth environment variables are missing.');
}
if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY missing. AI features will fail.');
}

const oAuth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY});

app.get('/api/auth/google', (_req: Request, res: Response) => {
  try {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events'
      ]
    });
    res.json({ url: authUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const { tokens } = await oAuth2Client.getToken(code);
    res.json({ tokens });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/calendar/events', (req, res) => getCalendarEvents(req, res, oAuth2Client));

app.post('/api/assistant/query', async (req: Request, res: Response) => {
  try {
    const { query, events, context} = req.body as { query: string; events: any[]; context : any};
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const groundingTool = {
        googleSearch: {}
    }

    const config = {
        tools: [groundingTool]
    }

    const prompt = `You are a calendar assistant. The user has the following events: ${JSON.stringify(events)}\n\nProvide a helpful response about their schedule. Only advise on scheduling and research applicable information. Do not create any events directly. If they want to add an event, provide the structured event information in JSON format that can be used to create a calendar event.\n\nYour conversation history with the user is:\n\n`;

    const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt + JSON.stringify(context),
        config,
    });
    const response = await result;
    const text = response.text;

    res.json({ response: text });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

const port = PORT || '3001';
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

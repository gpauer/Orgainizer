import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

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

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

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

app.get('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) {
      return res.status(401).json({ error: 'Missing token header' });
    }
    oAuth2Client.setCredentials({ access_token: token });

    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime'
    });

    res.json(response.data.items);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/assistant/query', async (req: Request, res: Response) => {
  try {
    const { query, events } = req.body as { query: string; events: any[] };
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a calendar assistant. The user has the following events: ${JSON.stringify(events)}\n\nUser query: ${query}\n\nProvide a helpful response about their schedule. Only advise on scheduling and research applicable information. Do not create any events directly. If they want to add an event, provide the structured event information in JSON format that can be used to create a calendar event.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({ response: text });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

const port = PORT || '3001';
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
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

// Simple in-memory token info cache
interface CachedTokenInfo { exp: number; checkedAt: number; }
const tokenInfoCache = new Map<string, CachedTokenInfo>();

async function requireValidToken(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    const cached = tokenInfoCache.get(token);
    const now = Date.now();
    if (cached && now < cached.exp - 30_000) { // 30s safety buffer
      return next();
    }
    // Validate token with Google; get remaining lifetime
    const info: any = await oAuth2Client.getTokenInfo(token);
    // Attempt to compute expiration; some environments return expires_in seconds.
    let exp = now + 5 * 60 * 1000; // default 5m if unknown
    if (typeof info.expires_in === 'number') {
      exp = now + info.expires_in * 1000;
    } else if (info.exp) {
      // exp as unix timestamp seconds
      exp = info.exp * 1000;
    }
    if (exp <= now) return res.status(401).json({ error: 'Token expired' });
    tokenInfoCache.set(token, { exp, checkedAt: now });
    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid or expired token', detail: err?.message });
  }
}

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


app.get('/api/calendar/events', requireValidToken, (req, res) => getCalendarEvents(req, res, oAuth2Client));

// Create a calendar event
app.post('/api/calendar/events', requireValidToken, async (req: Request, res: Response) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const { summary, description, location, start, end, attendees } = req.body as any;
    if (!summary || !start || !end) {
      return res.status(400).json({ error: 'summary, start, and end are required' });
    }
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const created = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        location,
        start,
        end,
        attendees
      }
    });
    res.status(201).json(created.data);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update (patch) a calendar event
app.put('/api/calendar/events/:id', requireValidToken, async (req: Request, res: Response) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const { id } = req.params;
    const { summary, description, location, start, end, attendees } = req.body as any;
    if (!id) return res.status(400).json({ error: 'Missing event id' });
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const updated = await calendar.events.patch({
      calendarId: 'primary',
      eventId: id,
      requestBody: {
        summary,
        description,
        location,
        start,
        end,
        attendees
      }
    });
    res.json(updated.data);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a calendar event
app.delete('/api/calendar/events/:id', requireValidToken, async (req: Request, res: Response) => {
  try {
    const token = req.headers['token'] as string | undefined;
    if (!token) return res.status(401).json({ error: 'Missing token header' });
    oAuth2Client.setCredentials({ access_token: token });
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing event id' });
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    await calendar.events.delete({ calendarId: 'primary', eventId: id });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/assistant/query', requireValidToken, async (req: Request, res: Response) => {
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

    const actionSchema = `Action JSON schema (return ONLY when user explicitly asks to change calendar):\n\n{
  "action": "create_event" | "update_event" | "delete_event",
  // create_event
  "event": { "summary": string, "description?": string, "location?": string, "start": {"dateTime"|"date": string}, "end": {"dateTime"|"date": string}, "attendees?": [{"email": string}] },
  // update/delete identifying target (prefer id if available from context events, else match details)
  "target": { "id?": string, "summary?": string, "start?": string },
  // update_event new values (same shape as event but partial)
  "updates?": { "summary?": string, "description?": string, "location?": string, "start?": {"dateTime"|"date": string}, "end?": {"dateTime"|"date": string} }
}\n\nRules: 1) Only output one JSON object per action. 2) For multiple actions, output them each in separate JSON code fences. 3) If user is only asking a question, DO NOT output action JSON.`;
    const prompt = `You are a calendar assistant. Current events: ${JSON.stringify(events)}\n\n${actionSchema}\nProvide a helpful natural language response first. Conversation history follows:\n\n`;

    const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt + JSON.stringify(context),
        config,
    });
    const response = await result;
    const text = response.text || '';
    const actions = extractActionsFromText(text);
    // Remove any fenced JSON blocks entirely from user-visible response
    let sanitized = text.replace(/```json[\s\S]*?```/g, '')
                        .replace(/```[\s\S]*?```/g, (m) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(m) ? '' : m));
    // Also remove solitary JSON objects that look like actions
    if (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(sanitized)) {
      sanitized = sanitized.replace(/\{[\s\S]*?\}/g, (obj) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(obj) ? '' : obj));
    }
    sanitized = sanitized.trim();
    res.json({ response: sanitized, actions });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Helper to extract structured actions (simple heuristic JSON extraction)
function extractActionsFromText(text: string) {
  // Look for JSON blocks that appear to contain an action
  const actions: any[] = [];
  const codeFenceMatches = text.match(/```(?:json)?\n([\s\S]*?)```/g) || [];
  const candidates: string[] = [];
  codeFenceMatches.forEach(block => {
    const inner = block.replace(/```(?:json)?\n?|```/g, '').trim();
    candidates.push(inner);
  });
  // Also naive brace match (first large JSON object)
  const braceMatch = text.match(/\{[\s\S]*\}/);
  // Only add brace match if no fenced JSON detected to avoid duplication
  if (codeFenceMatches.length === 0 && braceMatch) candidates.push(braceMatch[0]);
  const seen = new Set<string>();
  candidates.forEach(c => {
    try {
      const parsed = JSON.parse(c);
      const key = JSON.stringify(parsed);
      if (seen.has(key)) return; // dedupe identical JSON
      if (parsed && (parsed.action || parsed.type)) {
        actions.push(parsed);
        seen.add(key);
      } else if (parsed && parsed.summary && (parsed.start || parsed.end)) {
        const wrapped = { action: 'create_event', event: parsed };
        const wKey = JSON.stringify(wrapped);
        if (!seen.has(wKey)) {
          actions.push(wrapped);
          seen.add(wKey);
        }
      }
    } catch (_) {
      /* ignore */
    }
  });
  return actions;
}

// Streaming (SSE) endpoint for assistant
app.post('/api/assistant/stream', requireValidToken, async (req: Request, res: Response) => {
  try {
    const { query, events, context } = req.body as { query: string; events: any[]; context: any };
    if (!GEMINI_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ error: 'Gemini API key not configured' })}\n\n`);
      return res.end();
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const groundingTool = { googleSearch: {} };
    const config = { tools: [groundingTool] };
    const actionSchema = `Action JSON schema (return ONLY when user explicitly wants to modify calendar):\n{
  "action": "create_event" | "update_event" | "delete_event",
  "event?": { "summary": string, "description?": string, "location?": string, "start": {"dateTime"|"date": string}, "end": {"dateTime"|"date": string}, "attendees?": [{"email": string}] },
  "target?": { "id?": string, "summary?": string, "start?": string },
  "updates?": { "summary?": string, "description?": string, "location?": string, "start?": {"dateTime"|"date": string}, "end?": {"dateTime"|"date": string} }
}\nGuidelines: Only emit JSON inside a code fence when an action is clearly requested. For moves, use update_event with updates.start/end. For deletion, use delete_event with target.`;
    const prompt = `You are a calendar assistant. Current events: ${JSON.stringify(events)}\n\n${actionSchema}\nProvide an assistant reply. Conversation history:\n\n`;
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt + JSON.stringify(context) + '\nUser query: ' + query,
      config
    });
    const fullText = result.text || '';
    const actions = extractActionsFromText(fullText);
    // Sanitize visible text (strip action JSON)
    let sanitized = fullText.replace(/```json[\s\S]*?```/g, '')
                            .replace(/```[\s\S]*?```/g, (m) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(m) ? '' : m));
    if (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(sanitized)) {
      sanitized = sanitized.replace(/\{[\s\S]*?\}/g, (obj) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(obj) ? '' : obj));
    }
    sanitized = sanitized.trim();
    const rawChunks = sanitized.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [sanitized];
    const chunks = rawChunks.map(c => (c || '').trim()).filter(Boolean);
    for (const chunk of chunks) {
      if (chunk) res.write(`data: ${JSON.stringify({ delta: chunk + ' ' })}\n\n`);
    }
    if (actions.length) {
      res.write(`data: ${JSON.stringify({ type: 'actions', actions })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {
      // ignore double end
    }
  }
});

const port = PORT || '3001';
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

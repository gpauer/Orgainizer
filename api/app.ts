import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
import type { Request, Response, NextFunction } from 'express';
import { getCalendarEvents } from './calendar';

dotenv.config();

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI, GEMINI_API_KEY } = process.env as Record<string,string|undefined>;
  const oAuth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  interface CachedTokenInfo { exp: number; checkedAt: number; }
  const tokenInfoCache = new Map<string, CachedTokenInfo>();
  async function requireValidToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers['token'] as string | undefined;
      if (!token) return res.status(401).json({ error: 'Missing token header' });
      const cached = tokenInfoCache.get(token);
      const now = Date.now();
      if (cached && now < cached.exp - 30_000) return next();
      const info: any = await oAuth2Client.getTokenInfo(token);
      let exp = now + 5 * 60 * 1000;
      if (typeof info.expires_in === 'number') exp = now + info.expires_in * 1000; else if (info.exp) exp = info.exp * 1000;
      if (exp <= now) return res.status(401).json({ error: 'Token expired' });
      tokenInfoCache.set(token, { exp, checkedAt: now });
      next();
    } catch (err:any) {
      return res.status(401).json({ error: 'Invalid or expired token', detail: err?.message });
    }
  }

  app.get('/api/auth/google', (_req, res) => {
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
    } catch (e:any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    try {
      const code = req.query.code as string;
      const { tokens } = await oAuth2Client.getToken(code);
      res.json({ tokens });
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/calendar/events', requireValidToken, (req,res)=> getCalendarEvents(req,res,oAuth2Client));

  // Create event
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
        requestBody: { summary, description, location, start, end, attendees }
      });
      res.status(201).json(created.data);
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Update event
  app.put('/api/calendar/events/:id', requireValidToken, async (req, res) => {
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
        requestBody: { summary, description, location, start, end, attendees }
      });
      res.json(updated.data);
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Delete event
  app.delete('/api/calendar/events/:id', requireValidToken, async (req, res) => {
    try {
      const token = req.headers['token'] as string | undefined;
      if (!token) return res.status(401).json({ error: 'Missing token header' });
      oAuth2Client.setCredentials({ access_token: token });
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Missing event id' });
      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      await calendar.events.delete({ calendarId: 'primary', eventId: id });
      res.json({ success: true });
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Helper functions from server.ts duplicated here for Netlify environment
  function extractActionsFromText(text: string) {
    const actions: any[] = [];
    const codeFenceMatches = text.match(/```(?:json)?\n([\s\S]*?)```/g) || [];
    const candidates: string[] = [];
    codeFenceMatches.forEach(block => {
      const inner = block.replace(/```(?:json)?\n?|```/g, '').trim();
      candidates.push(inner);
    });
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (codeFenceMatches.length === 0 && braceMatch) candidates.push(braceMatch[0]);
    const seen = new Set<string>();
    candidates.forEach(c => {
      try {
        const parsed = JSON.parse(c);
        const key = JSON.stringify(parsed);
        if (seen.has(key)) return;
        if (parsed && (parsed.action || parsed.type)) {
          actions.push(parsed); seen.add(key);
        } else if (parsed && parsed.summary && (parsed.start || parsed.end)) {
          const wrapped = { action: 'create_event', event: parsed };
          const wKey = JSON.stringify(wrapped);
          if (!seen.has(wKey)) { actions.push(wrapped); seen.add(wKey); }
        }
      } catch {/* ignore */}
    });
    return actions;
  }

  // Assistant query endpoint (non-streaming)
  app.post('/api/assistant/query', requireValidToken, async (req, res) => {
    try {
      const { query, events, context } = req.body as { query: string; events: any[]; context: any };
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const groundingTool = { googleSearch: {} } as any;
      const config = { tools: [groundingTool] } as any;
      const actionSchema = `Action JSON schema (return ONLY when user explicitly asks to change calendar):\n\n{\n  "action": "create_event" | "update_event" | "delete_event",\n  "event": { "summary": string, "description?": string, "location?": string, "start": {"dateTime"|"date": string}, "end": {"dateTime"|"date": string}, "attendees?": [{"email": string}] },\n  "target": { "id?": string, "summary?": string, "start?": string },\n  "updates?": { "summary?": string, "description?": string, "location?": string, "start?": {"dateTime"|"date": string}, "end?": {"dateTime"|"date": string} }\n}`;
      const prompt = `You are a calendar assistant. Current events: ${JSON.stringify(events)}\n\n${actionSchema}\nProvide a helpful natural language response first. Conversation history follows:\n\n`;
      const result: any = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt + JSON.stringify(context) });
      const text = result.text || '';
      const actions = extractActionsFromText(text);
      let sanitized = text.replace(/```json[\s\S]*?```/g, '')
        .replace(/```[\s\S]*?```/g, (m: string) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(m) ? '' : m));
      if (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(sanitized)) {
        sanitized = sanitized.replace(/\{[\s\S]*?\}/g, (obj: string) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(obj) ? '' : obj));
      }
      sanitized = sanitized.trim();
      res.json({ response: sanitized, actions });
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Range inference endpoint (simplified copy)
  app.post('/api/assistant/range', requireValidToken, async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { query, today, context } = req.body as { query?: string; today?: string; context?: any };
      if (!query || !query.trim()) return res.status(400).json({ error: 'Missing query' });
      const now = today ? new Date(today) : new Date();
      const isoToday = now.toISOString().slice(0,10);
      const systemInstructions = `Determine minimal calendar date ranges needed to answer a user question or perform requested calendar actions. Output strict JSON only.\nOutput schema:{"ranges":[{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"..."}],"union":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"strategy":"brief explanation"}`;
      const prompt = `${systemInstructions}\nToday: ${isoToday}\nUser query: ${query}\nConversation (truncated): ${JSON.stringify((context||[]).slice(-6))}`;
      let jsonText = '';
      try {
        const result: any = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        jsonText = (result?.text || '').trim();
      } catch (err:any) {
        return res.json({ ranges: [], union: { start: isoToday, end: isoToday }, strategy: 'fallback', source: 'error' });
      }
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (!match) return res.json({ ranges: [], union: { start: isoToday, end: isoToday }, strategy: 'no-json', source: 'none' });
      let parsed: any; try { parsed = JSON.parse(match[0]); } catch { return res.json({ ranges: [], union: { start: isoToday, end: isoToday }, strategy: 'bad-json', source: 'parse' }); }
      res.json(parsed);
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Text to speech
  app.post('/api/assistant/tts', requireValidToken, async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { text, voiceName } = req.body as { text?: string; voiceName?: string };
      if (!text || !text.trim()) return res.status(400).json({ error: 'Missing text' });
      const voice = (voiceName || 'Kore').trim();
      const result: any = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: text.trim(),
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      });
      const candidate = result?.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const inline = part?.inlineData || part?.inline_data || {};
      const dataB64: string | undefined = inline.data || part?.data;
      if (!dataB64) return res.status(500).json({ error: 'No audio data returned' });
      res.json({ audio: dataB64, mimeType: inline.mimeType || inline.mime_type || 'audio/wav', voice });
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Transcribe
  app.post('/api/assistant/transcribe', requireValidToken, async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { audio, mimeType } = req.body as { audio?: string; mimeType?: string };
      if (!audio) return res.status(400).json({ error: 'Missing audio' });
      const result: any = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [ { role: 'user', parts: [ { inlineData: { data: audio, mimeType: mimeType || 'audio/wav' } }, { text: 'Transcribe the preceding audio accurately. Return only the raw transcript.' } ] } ]
      });
      const text = (result?.text || '').trim();
      res.json({ text });
    } catch (e:any) { res.status(400).json({ error: e.message }); }
  });

  // Streaming assistant (simplified: just returns full text lines via SSE)
  app.post('/api/assistant/stream', requireValidToken, async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ error: 'Gemini API key not configured' })}\n\n`); return res.end();
      }
      const { query, events, context } = req.body as { query: string; events: any[]; context: any };
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const prompt = `You are a calendar assistant. Events: ${JSON.stringify(events)}\nHistory: ${JSON.stringify(context)}`;
      const result: any = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt + '\nUser query: ' + query });
      const fullText = result.text || '';
      const actions = extractActionsFromText(fullText);
      let sanitized = fullText.replace(/```json[\s\S]*?```/g, '')
        .replace(/```[\s\S]*?```/g, (m: string) => (/"action"\s*:\s*"(create_event|update_event|delete_event)"/.test(m) ? '' : m));
      const lines = sanitized.trim().split(/\n/);
      for (const line of lines) res.write(`data: ${JSON.stringify({ delta: line + '\n' })}\n\n`);
      if (actions.length) res.write(`data: ${JSON.stringify({ type: 'actions', actions })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e:any) {
      try { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.write('data: [DONE]\n\n'); res.end(); } catch {/* ignore */}
    }
  });

  return app;
}

export function handlerless() { return createApp(); }

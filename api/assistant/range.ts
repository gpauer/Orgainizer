import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { buildHeuristicRanges, normalizeRange } from './utils';

export function assistantRangeHandler(ai: GoogleGenAI) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
  const { query, today, context } = req.body as { query?: string; today?: string; context?: any };
  const userTz = (req as any).userTz || 'UTC';
      if (!query || !query.trim()) return res.status(400).json({ error: 'Missing query' });
      const now = today ? new Date(today) : new Date();
      const isoToday = now.toISOString().slice(0,10);
  const systemInstructions = `You are a calendar assistant helping select minimal necessary calendar date ranges for data retrieval. ALWAYS reason in the user's timezone (${userTz}). Output strict JSON only.\nRules:\n1. Use the user's timezone for interpreting relative terms like "today", "next week", "tomorrow".\n2. Prefer a single contiguous range when months are consecutive.\n3. If user asks for multiple disjoint future periods (e.g., "June and September"), output separate ranges.\n4. Each range: start (inclusive ISO date), end (inclusive ISO date), reason (short rationale).\n5. Never exceed 18 months total span; if broader request, clamp & note in strategy.\n6. General questions => 1 week past today to 3 months ahead.\n7. Explicit months/dates => cover exactly those.\n8. "next X months" => today through end of Xth month ahead.\n9. Always ensure start <= end.\n10. Keep reasons <= 120 chars.\nOutput schema: {"ranges":[{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"..."}],"union":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"strategy":"brief explanation"}`;
  const prompt = `${systemInstructions}\nToday (user TZ ${userTz}): ${isoToday}\nUser query: ${query}\nConversation (truncated): ${JSON.stringify((context||[]).slice(-6))}`;
      let jsonText = '';
      try {
        const result: any = await ai.models.generateContent({ model: process.env.GEMINI_REALTIME_MODEL ?? '', contents: prompt });
        jsonText = (result?.text || '').trim();
      } catch {
        return res.json(buildHeuristicRanges(query, now));
      }
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (!match) return res.json(buildHeuristicRanges(query, now));
      let parsed: any;
      try { parsed = JSON.parse(match[0]); } catch { return res.json(buildHeuristicRanges(query, now)); }
      if (!Array.isArray(parsed.ranges)) return res.json(buildHeuristicRanges(query, now));
      const ranges = parsed.ranges.slice(0, 10).map((r: any) => normalizeRange(r, now));
      const valid = ranges.filter((r: any) => r);
      if (!valid.length) return res.json(buildHeuristicRanges(query, now));
      const sorted = [...valid].sort((a,b)=> a.start.localeCompare(b.start));
      const first = sorted[0];
      const last = sorted[sorted.length-1];
      const spanMonths = (new Date(last.end).getFullYear()-new Date(first.start).getFullYear())*12 + (new Date(last.end).getMonth()-new Date(first.start).getMonth());
      if (spanMonths > 18) {
        const clampEnd = new Date(first.start);
        clampEnd.setMonth(clampEnd.getMonth()+18);
        clampEnd.setDate(clampEnd.getDate()-1);
        parsed.strategy = (parsed.strategy || '') + ' | Clamped to 18 months';
        sorted[sorted.length-1].end = clampEnd.toISOString().slice(0,10);
      }
      const union = { start: sorted[0].start, end: sorted[sorted.length-1].end };
      res.json({ ranges: sorted, union, strategy: parsed.strategy || 'ai', source: 'ai' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}

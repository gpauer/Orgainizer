import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { buildHeuristicRanges, normalizeRange } from './utils';

export function assistantRangeHandler(ai: GoogleGenAI) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { query, today, context } = req.body as { query?: string; today?: string; context?: any };
      if (!query || !query.trim()) return res.status(400).json({ error: 'Missing query' });
      const now = today ? new Date(today) : new Date();
      const isoToday = now.toISOString().slice(0,10);
      const systemInstructions = `Determine minimal calendar date ranges needed to answer a user question or perform requested calendar actions. Output strict JSON only.\nRules:\n1. Prefer a single contiguous range when months are consecutive.\n2. If user asks for multiple disjoint future periods (e.g., "June and September"), output separate ranges.\n3. Each range: start (inclusive ISO date), end (inclusive ISO date), reason (short rationale).\n4. Never exceed 18 months total span; if request is broader, clamp & note in strategy.\n5. If question is general (e.g., "What does my schedule look like?"), pick from 1 week past today to 3 months ahead.\n6. If user references explicit dates or months, cover exactly those.\n7. For "next X months" choose today through end of Xth month ahead.\n8. Always ensure start <= end.\nOutput schema:\n{"ranges":[{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"..."}],"union":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"strategy":"brief explanation"}`;
      const prompt = `${systemInstructions}\nToday: ${isoToday}\nUser query: ${query}\nConversation (truncated): ${JSON.stringify((context||[]).slice(-6))}`;
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

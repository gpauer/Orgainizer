import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

export function assistantTranscribeHandler(ai: GoogleGenAI) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { audio, mimeType } = req.body as { audio?: string; mimeType?: string };
      if (!audio) return res.status(400).json({ error: 'Missing audio' });
      const result: any = await ai.models.generateContent({
        model: process.env.GEMINI_REALTIME_MODEL ?? '',
        contents: [ { role: 'user', parts: [ { inlineData: { data: audio, mimeType: mimeType || 'audio/wav' } }, { text: 'Transcribe the preceding audio accurately. Return only the raw transcript.' } ] } ]
      });
      const text = (result?.text || '').trim();
      res.json({ text });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}

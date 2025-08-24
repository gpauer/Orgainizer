import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

function pcm16ToWavBase64(pcmB64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const pcm = Buffer.from(pcmB64, 'base64');
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcm.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([wavHeader, pcm]);
  return wav.toString('base64');
}

export function assistantTTSHandler(ai: GoogleGenAI) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured' });
      const { text, voiceName } = req.body as { text?: string; voiceName?: string };
      if (!text || !text.trim()) return res.status(400).json({ error: 'Missing text' });
      const voice = (voiceName || 'Kore').trim();
      const result: any = await ai.models.generateContent({
        model: process.env.GEMINI_TTS_MODEL ?? '',
        contents: text.trim(),
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      });
      const candidate = result?.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const inline = part?.inlineData || part?.inline_data || {};
      const dataB64: string | undefined = inline.data || part?.data;
      const mime: string | undefined = inline.mimeType || inline.mime_type || part?.mimeType || part?.mime_type;
      if (!dataB64) return res.status(500).json({ error: 'No audio data returned' });
      let finalB64 = dataB64;
      let finalMime = 'audio/wav';
      if (!(mime && /wav/i.test(mime))) {
        finalB64 = pcm16ToWavBase64(dataB64);
      } else {
        finalMime = mime;
      }
      res.json({ audio: finalB64, mimeType: finalMime, originalMimeType: mime || null, voice });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };
}

export function assistantTTSStreamHandler(ai: GoogleGenAI) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ error: 'Gemini API key not configured' })}\n\n`);
        return res.end();
      }
      const { text, voiceName } = req.body as { text?: string; voiceName?: string };
      if (!text || !text.trim()) {
        res.writeHead(400, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ error: 'Missing text' })}\n\n`);
        return res.end();
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      (res as any).flushHeaders?.();
      const voice = (voiceName || 'Kore').trim();
      const result: any = await ai.models.generateContent({
        model: process.env.GEMINI_TTS_MODEL ?? '',
        contents: text.trim(),
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      });
      const candidate = result?.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      let dataB64: string | undefined = part?.inlineData?.data || part?.inline_data?.data || part?.data;
      if (!dataB64) {
        res.write(`data: ${JSON.stringify({ error: 'No audio data returned' })}\n\n`);
        res.write('data: {"done":true}\n\n');
        return res.end();
      }
      let buf = Buffer.from(dataB64, 'base64');
      if (buf.slice(0,4).toString('ascii') === 'RIFF' && buf.length > 44) buf = buf.slice(44); // drop wav header if present
      const sampleRate = 24000; const channels = 1; const bitsPerSample = 16;
      res.write(`data: ${JSON.stringify({ init: { sampleRate, channels, bitsPerSample, voice } })}\n\n`);
      const chunkSize = sampleRate * channels * (bitsPerSample/8) / 10; // ~100ms chunks
      for (let offset = 0; offset < buf.length; offset += chunkSize) {
        const chunk = buf.subarray(offset, Math.min(offset + chunkSize, buf.length));
        res.write(`data: ${JSON.stringify({ chunk: chunk.toString('base64') })}\n\n`);
      }
      res.write('data: {"done":true}\n\n');
      res.end();
    } catch (error: any) {
      try {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: {"done":true}\n\n');
        res.end();
      } catch {/* ignore */}
    }
  };
}

import React, { useState, useRef } from 'react';
import api from '../api/http';

interface VoiceAssistantProps { token: string; }

// Placeholder component for Gemini Live voice chat.
// Currently obtains a server-created session and prints instructions.
// Future: implement WebRTC offer/answer once backend endpoint is wired.
const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ token }) => {
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [level, setLevel] = useState(0);

  // Create audio level meter for microphone
  const startLevelMonitor = (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length); // typical speech ~0.02-0.05
        // Amplify for UI perception, clamp 0..1
        const visual = Math.min(1, rms * 8);
        setLevel(visual);
        if (activeRef.current) requestAnimationFrame(tick);
      };
      activeRef.current = true; // start loop immediately
      tick();
    } catch { /* ignore */ }
  };

  const startSession = async () => {
    setConnecting(true);
    setError(null);
    try {
      const events = (await api.get('/calendar/events')).data;
      const resp = await fetch('http://localhost:3001/api/assistant/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ events })
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Failed to start voice session');
      setSessionInfo(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  };

  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<Int16Array[]>([]);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const gainNodeRef = useRef<GainNode | null>(null);

  const drainQueue = () => {
    const ctx = playbackCtxRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (!playbackCtxRef.current) playbackCtxRef.current = ctx;
    if (!gainNodeRef.current) {
      gainNodeRef.current = ctx.createGain();
      gainNodeRef.current.gain.value = 1.0;
      gainNodeRef.current.connect(ctx.destination);
    }
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.05;
    // Schedule up to a few chunks ahead
    let scheduled = 0;
    while (audioBufferRef.current.length && scheduled < 4) {
      const chunk = audioBufferRef.current.shift();
      if (!chunk) break;
      const buffer = ctx.createBuffer(1, chunk.length, 24000);
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i] / 32768;
        data[i] = v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      // Simple normalization per chunk (avoid extreme jumps)
      const target = 0.85;
      if (peak > 0.01 && peak < target) {
        const scale = target / peak;
        for (let i = 0; i < data.length; i++) data[i] *= scale;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gainNodeRef.current!);
      src.start(nextPlayTimeRef.current);
      const dur = buffer.duration;
      nextPlayTimeRef.current += dur;
      scheduled++;
    }
    if (activeRef.current) setTimeout(drainQueue, 40);
  };

  const startCall = async () => {
    if (!sessionInfo?.session?.id) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startLevelMonitor(stream);
      // Connect websocket (bridge on port 3002 if server on 3001)
      const ws = new WebSocket(`ws://localhost:3002?sessionId=${sessionInfo.session.id}`);
      wsRef.current = ws;
      ws.onopen = () => {
        activeRef.current = true;
        setActive(true);
        // Capture at native device rate then resample to 16000 for API.
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(audioCtx.destination);
        let lastSend = performance.now();
        processor.onaudioprocess = e => {
          if (!activeRef.current) return;
          const input = e.inputBuffer.getChannelData(0);
          // Resample if needed
          const inRate = audioCtx.sampleRate;
          if (inRate === 16000) {
            const pcm16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              let s = input[i];
              s = Math.max(-1, Math.min(1, s));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            ws.send(JSON.stringify({ type: 'audio', data: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))) }));
          } else {
            // Simple linear interpolation resample to 16000
            const ratio = 16000 / inRate;
            const outLen = Math.floor(input.length * ratio);
            const out = new Float32Array(outLen);
            for (let i = 0; i < outLen; i++) {
              const idx = i / ratio;
              const i0 = Math.floor(idx);
              const i1 = Math.min(i0 + 1, input.length - 1);
              const frac = idx - i0;
              out[i] = input[i0] * (1 - frac) + input[i1] * frac;
            }
            const pcm16 = new Int16Array(out.length);
            for (let i = 0; i < out.length; i++) {
              let s = out[i];
              s = Math.max(-1, Math.min(1, s));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            ws.send(JSON.stringify({ type: 'audio', data: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer))) }));
          }
          // Periodically hint end-of-turn
            const now = performance.now();
            if (now - lastSend > 2000) {
              ws.send(JSON.stringify({ type: 'commit' }));
              lastSend = now;
            }
        };
      };
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'audio' && msg.data) {
            const buf = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
            const int16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
            audioBufferRef.current.push(int16);
            if (audioBufferRef.current.length === 1) drainQueue();
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => setError('Voice connection error');
      ws.onclose = () => setActive(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const stopCall = () => {
    activeRef.current = false;
    setActive(false);
    wsRef.current?.close();
    wsRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  };

  return (
    <div style={{ border: '1px solid #ccc', padding: 12, marginTop: 16 }}>
      <h3>Voice Assistant (Preview)</h3>
      {!sessionInfo && (
        <button onClick={startSession} disabled={connecting}>{connecting ? 'Starting...' : 'Start Voice Session'}</button>
      )}
      {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
      {sessionInfo && (
        <div style={{ marginTop: 8 }}>
          <p><strong>Instructions:</strong> {sessionInfo.instructions}</p>
          {sessionInfo.session ? (
            <>
              <p><strong>Session ID:</strong> {sessionInfo.session.id}</p>
              {!active ? (
                <button onClick={startCall} style={{ marginRight: 8 }}>Connect Audio</button>
              ) : (
                <button onClick={stopCall} style={{ marginRight: 8 }}>Hang Up</button>
              )}
              <span style={{ fontSize: 12, opacity: 0.7 }}>Audio level: {(level * 100).toFixed(0)}%</span>
              <div style={{ width: 120, height: 6, background: '#eee', marginTop: 4, position: 'relative' }}>
                <div style={{ width: `${Math.round(level * 100)}%`, height: '100%', background: level > 0.6 ? '#d33' : '#3a7' }} />
              </div>
              <audio ref={remoteAudioRef} autoPlay playsInline />
            </>
          ) : (
            <p>No upstream session (fallback mode).</p>
          )}
        </div>
      )}
    </div>
  );
};

export default VoiceAssistant;

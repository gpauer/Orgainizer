import React, { useState, useRef, useEffect } from 'react';
import api from '../api/http';
import './ChatAssistant.css';
import { MessageList } from './chat/MessageList';
import { ChatInput } from './chat/ChatInput';
import { ConversationMessage, GeminiAudioState } from './chat/types';

interface ChatAssistantProps { token: string; }

const ChatAssistant: React.FC<ChatAssistantProps> = ({ token }) => {
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [geminiAudio, setGeminiAudio] = useState<Record<number, GeminiAudioState>>({});
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  // Global tab mute state (persisted & broadcast via custom event)
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem('tabMuted') === '1');
  // Recording / transcription state
  const [recordingAuto, setRecordingAuto] = useState(false);      // mic that auto sends after transcription
  const [recordingAppend, setRecordingAppend] = useState(false);  // mic that appends text to input only
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<any>(null);
  const hadSoundRef = useRef(false);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const GEMINI_VOICES = ['Kore']; // trimmed list; UI currently hides voice selector

  // Keep refs of audio tags to invoke .play() programmatically (bypasses some autoplay quirks after user gesture)
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const streamStateRef = useRef<{ playingIndex?: number; bufferQueue: Float32Array[]; source?: AudioBufferSourceNode; started?: boolean; scheduledTime?: number; } | null>(null);
  const fetchedRangesRef = useRef<{ start: Date; end: Date }[]>([]);

  function ensureAudioCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (!gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = muted ? 0 : 1;
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    return audioCtxRef.current;
  }

  async function playPcmChunk(index: number, pcm16: Int16Array, sampleRate: number) {
    const ctx = ensureAudioCtx();
    if (!streamStateRef.current) {
      streamStateRef.current = { playingIndex: index, bufferQueue: [], scheduledTime: ctx.currentTime };
    }
    const st = streamStateRef.current;
    if (st.playingIndex !== index) {
      // New index; reset queue
      st.playingIndex = index;
      st.bufferQueue = [];
      st.scheduledTime = ctx.currentTime;
    }
    // Convert Int16 -> Float32
    const floatBuf = new Float32Array(pcm16.length);
    for (let i=0;i<pcm16.length;i++) floatBuf[i] = Math.max(-1, Math.min(1, pcm16[i] / 32768));
    const audioBuffer = ctx.createBuffer(1, floatBuf.length, sampleRate);
    audioBuffer.getChannelData(0).set(floatBuf);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    try {
      if (gainNodeRef.current) {
        src.disconnect();
        src.connect(gainNodeRef.current);
      }
    } catch { /* ignore */ }
    const startAt = Math.max(st.scheduledTime || ctx.currentTime, ctx.currentTime + 0.01);
    src.start(startAt);
    st.scheduledTime = startAt + audioBuffer.duration;
  }

  const API_ORIGIN = process.env.NODE_ENV === 'production'
    ? '/api' // relative
    : (process.env.REACT_APP_API_BASE || 'http://localhost:3001/api');

  async function streamGeminiTTS(index: number) {
  if (muted) return; // skip streaming while globally muted
    const msg = conversation[index];
    if (!msg || msg.role !== 'assistant' || !msg.content.trim()) return;
    try {
      setGeminiAudio(prev => ({ ...prev, [index]: { ...(prev[index]||{}), loading: true, error: undefined, autoplay: true } }));
  const resp = await fetch(`${API_ORIGIN}/assistant/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ text: stripMarkdown(msg.content).slice(0, 6000), voiceName: selectedVoice })
      });
      if (!resp.body) throw new Error('No stream body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sampleRate = 24000;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            try {
              const json = JSON.parse(payload);
              if (json.init) {
                sampleRate = json.init.sampleRate || sampleRate;
              } else if (json.chunk) {
                const raw = atob(json.chunk);
                const arr = new Int16Array(raw.length / 2);
                for (let i=0;i<raw.length;i+=2) {
                  arr[i/2] = (raw.charCodeAt(i) | (raw.charCodeAt(i+1) << 8)) << 16 >> 16;
                }
                playPcmChunk(index, arr, sampleRate);
              } else if (json.error) {
                setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], loading: false, error: json.error } }));
              } else if (json.done) {
                setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], loading: false } }));
              }
            } catch { /* ignore */ }
        }
      }
      setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], loading: false } }));
    } catch (err: any) {
      setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], loading: false, error: err.message } }));
    }
  }

  // Incremental segmentation for faster audio: finalize segment on punctuation or length/time threshold
  const segmentStateRef = useRef<{ processedChars: number; lastEmit: number }>( { processedChars: 0, lastEmit: 0 } );
  const segmentQueueRef = useRef<{ schedulingTime?: number } & Record<string, any>>({});

  const SEG_MIN_CHARS = 40;          // minimum chars before forcing a segment (if no punctuation)
  const SEG_MAX_WAIT_MS = 1500;      // max ms to wait before emitting a partial segment

  function finalizeSegment(index: number, fullText: string, upto: number) {
    if (upto <= segmentStateRef.current.processedChars) return;
    const segment = fullText.slice(segmentStateRef.current.processedChars, upto).trim();
    if (!segment) { segmentStateRef.current.processedChars = upto; return; }
    if (muted) { segmentStateRef.current.processedChars = upto; return; }
    segmentStateRef.current.processedChars = upto;
    segmentStateRef.current.lastEmit = Date.now();
    startStreamingSegment(index, segment);
  }

  function considerEmitSegments(index: number, fullText: string, done = false) {
    const { processedChars, lastEmit } = segmentStateRef.current;
    if (fullText.length <= processedChars) return;
    const newPortion = fullText.slice(processedChars);
    // Look for last punctuation in new portion
    const punctMatch = newPortion.match(/([.!?])(?=[^.!?]*$)/); // last punctuation
    if (punctMatch) {
      const lastIndex = newPortion.lastIndexOf(punctMatch[1]) + 1;
      finalizeSegment(index, fullText, processedChars + lastIndex);
    } else {
      // Force emit if length/time thresholds exceeded
      if (newPortion.length >= SEG_MIN_CHARS && Date.now() - lastEmit >= SEG_MAX_WAIT_MS) {
        finalizeSegment(index, fullText, fullText.length);
      } else if (done) {
        // On done flush everything
        finalizeSegment(index, fullText, fullText.length);
      }
    }
  }

  async function startStreamingSegment(index: number, text: string) {
  if (muted) return; // don't start segment stream if muted
    try {
      // Mark loading state (streaming)
      setGeminiAudio(prev => ({ ...prev, [index]: { ...(prev[index]||{}), loading: true, autoplay: true } }));
  const resp = await fetch(`${API_ORIGIN}/assistant/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ text, voiceName: selectedVoice })
      });
      if (!resp.body) throw new Error('No TTS stream body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let sampleRate = 24000;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\n/); buf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            const json = JSON.parse(payload);
            if (json.init) {
              sampleRate = json.init.sampleRate || sampleRate;
            } else if (json.chunk) {
              const b = atob(json.chunk);
              const arr = new Int16Array(b.length / 2);
              for (let i=0;i<b.length;i+=2) {
                arr[i/2] = (b.charCodeAt(i) | (b.charCodeAt(i+1) << 8)) << 16 >> 16;
              }
              playPcmChunk(index, arr, sampleRate);
            } else if (json.error) {
              setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], error: json.error, loading: false } }));
            } else if (json.done) {
              setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], loading: false } }));
            }
          } catch {/* ignore */}
        }
      }
    } catch (err: any) {
      setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], error: err.message, loading: false } }));
    }
  }

  // Attempt programmatic playback whenever new autoplay audio arrives and not muted
  useEffect(() => {
    if (muted) return;
    for (const [k,v] of Object.entries(geminiAudio)) {
      const idx = Number(k);
      if (v?.src && v.autoplay) {
        const el = audioRefs.current[idx];
        if (el && el.paused) { el.play().catch(()=>{}); }
      }
    }
  }, [geminiAudio, muted]);

  // Apply mute/unmute to ALL media elements in the tab + WebAudio
  useEffect(() => {
    const apply = (flag: boolean) => {
      // Persist
      localStorage.setItem('tabMuted', flag ? '1' : '0');
      // Media elements
      document.querySelectorAll('audio,video').forEach(el => {
        const m = el as HTMLMediaElement;
        m.muted = flag;
        if (flag) m.volume = 0; else if (m.volume === 0) m.volume = 1;
      });
      // Web Audio
      if (gainNodeRef.current) {
        try { gainNodeRef.current.gain.setValueAtTime(flag ? 0 : 1, (audioCtxRef.current || ensureAudioCtx()).currentTime); } catch {/* ignore */}
      }
      if (audioCtxRef.current) {
        try { flag ? audioCtxRef.current.suspend() : audioCtxRef.current.resume(); } catch {/* ignore */}
      }
    };
    apply(muted);
    // Broadcast so other components (future) can react
    window.dispatchEvent(new CustomEvent('app:tab-mute-changed', { detail: { muted } }));
  }, [muted]);

  // Listen for external mute changes (if some other component toggles)
  useEffect(() => {
    const handler = (e: any) => {
      const v = !!e?.detail?.muted;
      setMuted(prev => prev === v ? prev : v);
    };
    window.addEventListener('app:tab-mute-changed', handler);
    return () => window.removeEventListener('app:tab-mute-changed', handler);
  }, []);

  // MutationObserver to auto-mute any newly inserted media elements when muted
  useEffect(() => {
    if (!muted) return; // only needed while muted
    const obs = new MutationObserver(recs => {
      if (!muted) return;
      for (const r of recs) {
        r.addedNodes.forEach(n => {
          if (n instanceof HTMLMediaElement) {
            n.muted = true; n.volume = 0;
          } else if (n instanceof HTMLElement) {
            n.querySelectorAll('audio,video').forEach(el => { (el as HTMLMediaElement).muted = true; (el as HTMLMediaElement).volume = 0; });
          }
        });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [muted]);

  // Cleanup any active speech on unmount
  useEffect(() => { /* no-op cleanup retained for future */ }, []);

  // Auto-generate voice when a new assistant message is finalized (content not empty) and no audio yet.
  useEffect(() => {
    // When final assistant message done streaming, flush any residual segment
    if (muted) return;
    const lastIndex = conversation.length - 1;
    if (lastIndex < 0) return;
    const last = conversation[lastIndex];
    if (last.role !== 'assistant') return;
    if (!last.content) return;
    // If streaming ended (we rely on [DONE] having run), consider emit remaining
    // This is a soft check; actual finalize also triggered by handleSubmit on DONE if needed
  }, [conversation, muted]);

  // speakMessage removed (browser TTS no longer used)

  // Removed browser pause/resume/stop handlers

  const requestGeminiTTS = async (index: number, autoplay = false) => {
  if (muted) return; // do not issue TTS requests while muted
    const msg = conversation[index];
    if (!msg || msg.role !== 'assistant' || !msg.content.trim()) return;
    setGeminiAudio(prev => ({ ...prev, [index]: { ...(prev[index]||{}), loading: true, error: undefined, autoplay } }));
    try {
      const plain = stripMarkdown(msg.content).slice(0, 6000);
      const resp = await api.post('/assistant/tts', { text: plain, voiceName: selectedVoice });
      const { audio, mimeType, voice } = resp.data;
      if (!audio) throw new Error('Empty audio');
      const src = `data:${mimeType || 'audio/wav'};base64,${audio}`;
      setGeminiAudio(prev => ({ ...prev, [index]: { src, loading: false, voice, autoplay } }));
    } catch (err: any) {
      setGeminiAudio(prev => ({ ...prev, [index]: { loading: false, error: err.message } }));
    }
  };

  // Strip simple markdown for cleaner TTS
  function stripMarkdown(text: string): string {
    return text
      .replace(/`{1,3}[^`]*`{1,3}/g, ' ') // code blocks & inline code
      .replace(/\!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[[^\]]*\]\([^)]*\)/g, '$1') // links -> label only
      .replace(/[#>*_~`>-]/g, ' ') // markdown symbols
      .replace(/\s+/g, ' ') // collapse whitespace
      .trim();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    await sendQuery(query.trim());
  };

  // Reusable send function (used by form and auto voice)
  const sendQuery = async (text: string) => {
    if (!text || isLoading) return;
    const newConversation: ConversationMessage[] = [
      ...conversation,
      { role: 'user', content: text }
    ];
    setConversation(newConversation);
    setIsLoading(true);
    setQuery('');
    try {
      // Ask backend AI for needed date ranges
      let rangesResp: any = null;
      try {
        const r = await api.post('/assistant/range', { query: text, context: newConversation });
        rangesResp = r.data;
      } catch (e) {
        // ignore; fallback will be no params
      }
      let eventsPayload: any[] = [];
      if (rangesResp?.union) {
        const unionStart = new Date(rangesResp.union.start + 'T00:00:00.000Z');
        const unionEnd = new Date(rangesResp.union.end + 'T23:59:59.999Z');
        const covered = fetchedRangesRef.current.some(r => unionStart >= r.start && unionEnd <= r.end);
        if (covered) {
          // Use last known events from calendar refresh (could optionally store snapshot)
          const eventsResponse = await api.get('/calendar/events');
          eventsPayload = Array.isArray(eventsResponse.data) ? eventsResponse.data : (eventsResponse.data.events || eventsResponse.data);
        } else {
          const eventsResponse = await api.get(`/calendar/events?start=${encodeURIComponent(unionStart.toISOString())}&end=${encodeURIComponent(unionEnd.toISOString())}`);
          eventsPayload = Array.isArray(eventsResponse.data) ? eventsResponse.data : (eventsResponse.data.events || eventsResponse.data);
          fetchedRangesRef.current.push({ start: unionStart, end: unionEnd });
          // Merge overlapping cached ranges
          fetchedRangesRef.current = mergeRanges(fetchedRangesRef.current);
        }
      } else {
        const eventsResponse = await api.get('/calendar/events');
        eventsPayload = Array.isArray(eventsResponse.data) ? eventsResponse.data : (eventsResponse.data.events || eventsResponse.data);
      }
      setConversation(prev => ([...prev, { role: 'assistant', content: '' }]));
      segmentStateRef.current = { processedChars: 0, lastEmit: Date.now() };
  const resp = await fetch(`${API_ORIGIN}/assistant/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ query: text, events: eventsPayload, context: newConversation })
      });
      if (!resp.body) throw new Error('No stream body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const applyAssistantText = () => {
        setConversation(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: assistantText };
          return copy;
        });
      };
      async function executeActions(actions: any[]) {
        // Try to batch create events if multiple create_event actions present
        const createPayload = actions.filter(a => a.action === 'create_event' && a.event).map(a => a.event);
        if (createPayload.length > 1) {
          try {
            await api.post('/calendar/events', createPayload);
            assistantText += `\n\n✅ Created ${createPayload.length} events.`;
            window.dispatchEvent(new Event('calendar:refresh'));
          } catch (err: any) {
            assistantText += `\n\n❌ Failed batch create: ${err.message}`;
          }
        }
        // Pre-resolve target ids for delete batch
        const deleteTargets: string[] = [];
        for (const action of actions) {
          if (action.action === 'delete_event') {
            let id = action.target?.id;
            if (!id) {
              const events = eventsPayload as any[];
              const match = events.find(ev => (
                (action.target?.summary && ev.summary === action.target.summary) &&
                (action.target?.start ? (ev.start?.dateTime || ev.start?.date) === action.target.start : true)
              ));
              if (match) id = match.id;
            }
            if (id) deleteTargets.push(id);
          }
        }
        if (deleteTargets.length > 1) {
          try {
            await api.post('/calendar/events/batch-delete', { ids: deleteTargets });
            assistantText += `\n\n🗑 Deleted ${deleteTargets.length} events.`;
            window.dispatchEvent(new Event('calendar:refresh'));
          } catch (err: any) {
            assistantText += `\n\n❌ Failed batch delete: ${err.message}`;
          }
        }
        for (const action of actions) {
          if (action.action === 'delete_event' && deleteTargets.length > 1) continue; // already handled
          // Skip individual create if already covered by batch
          if (action.action === 'create_event' && createPayload.length > 1) continue;
          try {
            if (action.action === 'create_event' && action.event) {
              await api.post('/calendar/events', action.event);
              assistantText += `\n\n✅ Created event: ${action.event.summary}`;
            } else if (action.action === 'update_event') {
              let id = action.target?.id;
              if (!id) {
                const events = eventsPayload as any[];
                const match = events.find(ev => (
                  (action.target?.summary && ev.summary === action.target.summary) &&
                  (action.target?.start ? (ev.start?.dateTime || ev.start?.date) === action.target.start : true)
                ));
                if (match) id = match.id;
              }
              if (id) {
                await api.put(`/calendar/events/${id}`, { ...action.updates });
                assistantText += `\n\n🛠 Updated event ${id}`;
              } else {
                assistantText += `\n\n⚠ Could not resolve event to update.`;
              }
            } else if (action.action === 'delete_event') {
              let id = action.target?.id;
              if (!id) {
                const events = eventsPayload as any[];
                const match = events.find(ev => (
                  (action.target?.summary && ev.summary === action.target.summary) &&
                  (action.target?.start ? (ev.start?.dateTime || ev.start?.date) === action.target.start : true)
                ));
                if (match) id = match.id;
              }
              if (id) {
                // Capture event details for undo before deletion
                let deletedEvent: any = (eventsPayload as any[]).find(ev => ev.id === id);
                try {
                  await api.delete(`/calendar/events/${id}`);
                } catch (delErr: any) {
                  assistantText += `\n\n❌ Failed to delete event ${id}: ${delErr.message}`;
                  applyAssistantText();
                  return;
                }
                assistantText += `\n\n🗑 Deleted event ${id}`;
                // Notify calendar to remove immediately & show undo
                if (deletedEvent) {
                  window.dispatchEvent(new CustomEvent('calendar:eventDeleted', { detail: { event: deletedEvent } }));
                } else {
                  window.dispatchEvent(new Event('calendar:refresh'));
                }
              } else {
                assistantText += `\n\n⚠ Could not resolve event to delete.`;
              }
            }
            window.dispatchEvent(new Event('calendar:refresh'));
          } catch (err: any) {
            assistantText += `\n\n❌ Action failed (${action.action}): ${err.message}`;
          }
          applyAssistantText();
        }
      }
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.substring(5).trim();
          if (payload === '[DONE]') {
            const currentIndex = conversation.length; // assistant placeholder index offset
            considerEmitSegments(currentIndex - 1, stripMarkdown(assistantText), true);
            buffer = '';
            break;
          }
          try {
            const json = JSON.parse(payload);
            if (json.delta) {
              assistantText += json.delta;
              applyAssistantText();
              const currentIndex = conversation.length;
              considerEmitSegments(currentIndex - 1, stripMarkdown(assistantText));
            } else if (json.type === 'actions' && Array.isArray(json.actions)) {
              assistantText += '\n\nProcessing requested calendar actions...';
              applyAssistantText();
              await executeActions(json.actions);
            } else if (json.error) {
              assistantText += `\n\nError: ${json.error}`;
              applyAssistantText();
            }
          } catch { /* ignore */ }
        }
      }
    } catch (error) {
      console.error('Error with AI assistant:', error);
      setConversation(prev => ([...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]));
    } finally {
      setIsLoading(false);
    }
  };

  // (Removed unused helper functions buildRangeParamsFromQuery / inferYearForMonth)

  // ---- Voice Recording Logic ----
  async function startRecording(kind: 'auto' | 'append') {
    if (recordingAuto || recordingAppend || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recordedChunksRef.current = [];
      hadSoundRef.current = false;
      mr.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        clearTimeout(silenceTimerRef.current);
        stream.getTracks().forEach(t => t.stop());
        if (!recordedChunksRef.current.length) { resetRecordingState(); return; }
        setTranscribing(true);
        try {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(arrayBuffer);
          const resp = await fetch(`${API_ORIGIN}/assistant/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' })
          });
          const data = await resp.json();
          const text: string = (data.text || '').trim();
          if (text) {
            if (kind === 'append') {
              // Append into current input caret position
              setQuery(q => (q ? (q.endsWith(' ') ? q + text : q + ' ' + text) : text));
            } else {
              // Auto send transcript as user message
              setQuery(text);
              // slight delay to allow React to set state before submit
              setTimeout(() => {
                const form = document.querySelector('.chat-input form') as HTMLFormElement | null;
              }, 0);
              // Directly send the transcript
              sendQuery(text);
            }
          }
        } catch (err) {
          console.error('Transcription failed', err);
        } finally {
          setTranscribing(false);
          resetRecordingState();
        }
      };
      mr.start(250); // timeslice
      mediaRecorderRef.current = mr;
      if (kind === 'auto') setRecordingAuto(true); else setRecordingAppend(true);
      // Basic silence stop using analyser
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const SILENCE_MS = 2500;
      const SILENCE_THRESHOLD = 8; // very low energy threshold
      let lastSoundTs = Date.now();
      function check() {
        analyser.getByteTimeDomainData(data);
        // compute simple peak deviation from midpoint (128)
        let peak = 0;
        for (let i=0;i<data.length;i+=16) { // subsample
          const dev = Math.abs(data[i] - 128);
          if (dev > peak) peak = dev;
        }
        if (peak > SILENCE_THRESHOLD) {
          hadSoundRef.current = true;
          lastSoundTs = Date.now();
        }
        if (hadSoundRef.current && Date.now() - lastSoundTs > SILENCE_MS) {
          mr.stop();
          ctx.close();
          return;
        }
        if (mr.state !== 'inactive') requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
      // Safety max length 30s
      silenceTimerRef.current = setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); ctx.close(); }, 30000);
    } catch (err) {
      console.error('Mic start failed', err);
      resetRecordingState();
    }
  }

  function stopRecording() {
    try { mediaRecorderRef.current?.stop(); } catch {/* ignore */}
  }

  function resetRecordingState() {
    setRecordingAuto(false);
    setRecordingAppend(false);
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    clearTimeout(silenceTimerRef.current);
    const s = audioStreamRef.current; if (s) s.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
  }

  function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  return (
    <div className="chat-container">
      <div className="chat-messages">
        <MessageList
          conversation={conversation}
          geminiAudio={geminiAudio}
          requestGeminiTTS={requestGeminiTTS}
            audioRefs={audioRefs}
          muted={muted}
          selectedVoice={selectedVoice}
        />
        {isLoading && <div className="message assistant loading">Thinking...</div>}
      </div>
      <ChatInput
        query={query}
        setQuery={setQuery}
        handleSubmit={handleSubmit}
        muted={muted}
        setMuted={setMuted}
        isLoading={isLoading}
        transcribing={transcribing}
        recordingAuto={recordingAuto}
        recordingAppend={recordingAppend}
        startRecording={startRecording}
        stopRecording={stopRecording}
      />
    </div>
  );
};

export default ChatAssistant;

function mergeRanges(ranges: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a,b)=> a.start.getTime()-b.start.getTime());
  const merged: { start: Date; end: Date }[] = [];
  for (const r of sorted) {
    const last = merged[merged.length-1];
    if (!last) { merged.push(r); continue; }
    if (r.start.getTime() <= last.end.getTime()+ 86400000) { // join if overlapping or adjacent (1 day buffer)
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push(r);
    }
  }
  return merged;
}

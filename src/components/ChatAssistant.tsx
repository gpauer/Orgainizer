import React, { useState, useRef, useEffect } from 'react';
import api from '../api/http';
import './ChatAssistant.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';

interface ChatAssistantProps {
  token: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GeminiAudioState {
  src?: string;
  loading: boolean;
  error?: string;
  voice?: string;
  autoplay?: boolean;
  playError?: string; // if browser blocked autoplay
}

const ChatAssistant: React.FC<ChatAssistantProps> = ({ token }) => {
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [geminiAudio, setGeminiAudio] = useState<Record<number, GeminiAudioState>>({});
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [muted, setMuted] = useState(false);
  const GEMINI_VOICES = [
    'Kore','Puck','Zephyr','Charon','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi','Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi','Vindemiatrix','Sadachbia','Sadaltager','Sulafat'
  ];

  // Keep refs of audio tags to invoke .play() programmatically (bypasses some autoplay quirks after user gesture)
  const audioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamStateRef = useRef<{ playingIndex?: number; bufferQueue: Float32Array[]; source?: AudioBufferSourceNode; started?: boolean; scheduledTime?: number; } | null>(null);

  function ensureAudioCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    const startAt = Math.max(st.scheduledTime || ctx.currentTime, ctx.currentTime + 0.01);
    src.start(startAt);
    st.scheduledTime = startAt + audioBuffer.duration;
  }

  async function streamGeminiTTS(index: number) {
    const msg = conversation[index];
    if (!msg || msg.role !== 'assistant' || !msg.content.trim()) return;
    try {
      setGeminiAudio(prev => ({ ...prev, [index]: { ...(prev[index]||{}), loading: true, error: undefined, autoplay: true } }));
      const resp = await fetch('http://localhost:3001/api/assistant/tts/stream', {
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
    try {
      // Mark loading state (streaming)
      setGeminiAudio(prev => ({ ...prev, [index]: { ...(prev[index]||{}), loading: true, autoplay: true } }));
      const resp = await fetch('http://localhost:3001/api/assistant/tts/stream', {
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
    Object.entries(geminiAudio).forEach(([k, v]) => {
      const idx = Number(k);
      if (v?.src && v.autoplay) {
        const el = audioRefs.current[idx];
        if (el && el.paused) {
          el.play().catch(() => { /* ignore (likely policy) */ });
        }
      }
    });
  }, [geminiAudio, muted]);

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

  // Prepare updated conversation immediately so we can send it in the request.
    const newConversation: ConversationMessage[] = [
      ...conversation,
      { role: 'user', content: query }
    ];
    setConversation(newConversation);
    setIsLoading(true);

    try {
      const eventsResponse = await api.get('/calendar/events');
      // Start streaming request
  setConversation(prev => ([...prev, { role: 'assistant', content: '' }]));
  // Reset segmentation state for new assistant response
  segmentStateRef.current = { processedChars: 0, lastEmit: Date.now() };
      const resp = await fetch('http://localhost:3001/api/assistant/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token },
        body: JSON.stringify({ query, events: eventsResponse.data, context: newConversation })
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
        for (const action of actions) {
          try {
            if (action.action === 'create_event' && action.event) {
              await api.post('/calendar/events', action.event);
              assistantText += `\n\n✅ Created event: ${action.event.summary}`;
            } else if (action.action === 'update_event') {
              // Attempt to resolve id
              let id = action.target?.id;
              if (!id) {
                // Try to find by summary + start
                const events = eventsResponse.data as any[];
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
                const events = eventsResponse.data as any[];
                const match = events.find(ev => (
                  (action.target?.summary && ev.summary === action.target.summary) &&
                  (action.target?.start ? (ev.start?.dateTime || ev.start?.date) === action.target.start : true)
                ));
                if (match) id = match.id;
              }
              if (id) {
                await api.delete(`/calendar/events/${id}`);
                assistantText += `\n\n🗑 Deleted event ${id}`;
              } else {
                assistantText += `\n\n⚠ Could not resolve event to delete.`;
              }
            }
            // Notify calendar to refresh after each action
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
              // Flush any remaining segment on completion
              const currentIndex = conversation.length; // assistant placeholder at end
              considerEmitSegments(currentIndex - 1, stripMarkdown(assistantText), true);
              buffer = '';
              break;
            }
            try {
              const json = JSON.parse(payload);
              if (json.delta) {
                assistantText += json.delta;
                applyAssistantText();
                // Consider emitting partial segment for TTS
                const currentIndex = conversation.length; // assistant placeholder at end
                considerEmitSegments(currentIndex - 1, stripMarkdown(assistantText));
              } else if (json.type === 'actions' && Array.isArray(json.actions)) {
                assistantText += '\n\nProcessing requested calendar actions...';
                applyAssistantText();
                await executeActions(json.actions);
              } else if (json.error) {
                assistantText += `\n\nError: ${json.error}`;
                applyAssistantText();
              }
            } catch {
              // ignore
            }
        }
      }
  // Finished streaming. (Full-message TTS no longer auto-triggered here; sentence-level already queued.)
    } catch (error) {
      console.error('Error with AI assistant:', error);
      setConversation(prev => ([...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]));
    } finally {
      setIsLoading(false);
      setQuery('');
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {conversation.length === 0 ? (
          <div className="welcome-message">
            <h3>Hello! I'm your calendar assistant.</h3>
            <p>
              Ask me about your schedule, to summarize your upcoming events, or
              for help planning your time.
            </p>
          </div>
        ) : (
          conversation.map((msg, index) => {
            const mdComponents: Components = {
              a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" />,
              code: ({className, children, ...props}: any) => {
                const inline = (props as any).inline;
                return (
                  <code className={inline ? 'inline-code' : `code-block ${className || ''}`.trim()} {...props}>{children}</code>
                );
              },
              ul: ({node, ...props}) => <ul className="msg-list" {...props} />,
              ol: ({node, ...props}) => <ol className="msg-list" {...props} />,
              blockquote: ({node, ...props}) => <blockquote className="msg-quote" {...props} />
            };
            return (
              <div key={index} className={`message ${msg.role}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {msg.content}
                </ReactMarkdown>
                {msg.role === 'assistant' && !!msg.content && (
                  <div className="tts-controls">
                    {geminiAudio[index]?.src ? (
                      <audio
                        ref={el => { audioRefs.current[index] = el; }}
                        controls
                        src={geminiAudio[index].src}
                        style={{ maxWidth: '220px' }}
                        playsInline
                        muted={false}
                        autoPlay={false}
                        onCanPlay={() => {
                          const meta = geminiAudio[index];
                          if (meta?.autoplay && !muted) {
                            const el = audioRefs.current[index];
                            el?.play().catch(err => {
                              setGeminiAudio(prev => ({ ...prev, [index]: { ...prev[index], playError: err?.name || 'play_failed' } }));
                            });
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={geminiAudio[index]?.loading}
                        onClick={() => requestGeminiTTS(index)}
                        className="tts-btn"
                        title={`Generate voice (${selectedVoice})`}
                      >{geminiAudio[index]?.loading ? '⏳' : '🎤 Voice'}</button>
                    )}
                    {(geminiAudio[index]?.error || geminiAudio[index]?.playError) && (
                      <span style={{ color: '#c00', fontSize: '0.7rem', marginLeft: '0.4rem' }} title={geminiAudio[index]?.error || geminiAudio[index]?.playError}>⚠</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {isLoading && <div className="message assistant loading">Thinking...</div>}
      </div>

      <form onSubmit={handleSubmit} className="chat-input">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ask about your schedule..."
          disabled={isLoading}
        />
  {/* Auto browser speech toggle removed */}
        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          className="tts-btn"
          style={{ marginLeft: '0.5rem' }}
          title={muted ? 'Unmute voice playback' : 'Mute voice playback'}
        >{muted ? '🔇' : '🔊'}</button>
        <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} disabled={isLoading} style={{ marginLeft: '0.5rem' }} title="Gemini TTS voice">
          {GEMINI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <button type="submit" disabled={isLoading || !query.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatAssistant;

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';
import { ConversationMessage, GeminiAudioState } from './types';

interface MessageListProps {
  conversation: ConversationMessage[];
  geminiAudio: Record<number, GeminiAudioState>;
  requestGeminiTTS: (index: number) => void;
  audioRefs: React.MutableRefObject<Record<number, HTMLAudioElement | null>>;
  muted: boolean;
  selectedVoice: string;
}

export const MessageList: React.FC<MessageListProps> = ({ conversation, geminiAudio, requestGeminiTTS, audioRefs, muted, selectedVoice }) => {
  if (conversation.length === 0) {
    return (
      <div className="welcome-message">
        <h3>Hello! I'm your calendar assistant.</h3>
        <p>Ask me about your schedule, to summarize upcoming events, or for help planning.</p>
      </div>
    );
  }
  return (
    <>
      {conversation.map((msg, index) => {
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
                    muted={muted}
                    autoPlay={false}
                    onCanPlay={() => {
                      const meta = geminiAudio[index];
                      if (meta?.autoplay && !muted) {
                        const el = audioRefs.current[index];
                        el?.play().catch(err => {
                          // eslint-disable-next-line no-console
                          console.warn('Autoplay failed', err);
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
      })}
    </>
  );
};

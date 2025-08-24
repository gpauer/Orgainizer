import React from 'react';

interface ChatInputProps {
  query: string;
  setQuery: (v: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  transcribing: boolean;
  recordingAuto: boolean;
  recordingAppend: boolean;
  startRecording: (kind: 'auto' | 'append') => void;
  stopRecording: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ query, setQuery, handleSubmit, muted, setMuted, isLoading, transcribing, recordingAuto, recordingAppend, startRecording, stopRecording }) => {
  return (
    <form onSubmit={handleSubmit} className="chat-input">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Ask about your schedule..."
        disabled={isLoading}
      />
      <button
        type="button"
        className="tts-btn"
        disabled={isLoading || transcribing || recordingAppend}
        title={recordingAuto ? 'Stop & transcribe (auto send)' : 'Hold a voice note (auto send after silence)'}
        onClick={() => recordingAuto ? stopRecording() : startRecording('auto')}
        style={{ marginLeft: '0.5rem' }}
      >{recordingAuto ? '⏺️' : '🎙️'}</button>
      <button
        type="button"
        onClick={() => setMuted(m => !m)}
        className="tts-btn"
        style={{ marginLeft: '0.5rem' }}
        title={muted ? 'Unmute all tab audio' : 'Mute all tab audio'}
        aria-pressed={muted}
      >{muted ? '🔇' : '🔊'}</button>
      <button type="submit" disabled={isLoading || !query.trim()}>
        Send
      </button>
    </form>
  );
};

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GeminiAudioState {
  src?: string;
  loading: boolean;
  error?: string;
  voice?: string;
  autoplay?: boolean;
  playError?: string; // if browser blocked autoplay
}

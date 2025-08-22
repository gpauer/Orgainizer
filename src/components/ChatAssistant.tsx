import React, { useState } from 'react';
import axios from 'axios';

interface ChatAssistantProps {
  token: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ChatAssistant: React.FC<ChatAssistantProps> = ({ token }) => {
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setConversation(prev => [...prev, { role: 'user', content: query }]);
    setIsLoading(true);

    try {
      const eventsResponse = await axios.get('http://localhost:3001/api/calendar/events', {
        headers: { token }
      });

      const aiResponse = await axios.post('http://localhost:3001/api/assistant/query', {
        query,
        events: eventsResponse.data
      });

      setConversation(prev => [
        ...prev,
        {
          role: 'assistant',
          content: aiResponse.data.response
        }
      ]);
    } catch (error) {
      console.error('Error with AI assistant:', error);
      setConversation(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.'
        }
      ]);
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
          conversation.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              {msg.content}
            </div>
          ))
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
        <button type="submit" disabled={isLoading || !query.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatAssistant;

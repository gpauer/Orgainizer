import React, { useState } from 'react';
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

const ChatAssistant: React.FC<ChatAssistantProps> = ({ token }) => {
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

      console.log("Context sent: " + JSON.stringify(newConversation));

  const aiResponse = await api.post('/assistant/query', {
        query,
        events: eventsResponse.data,
        context: newConversation
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
        <button type="submit" disabled={isLoading || !query.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatAssistant;

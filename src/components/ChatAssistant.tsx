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
      // Start streaming request
      setConversation(prev => ([...prev, { role: 'assistant', content: '' }]));
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
              buffer = '';
              break;
            }
            try {
              const json = JSON.parse(payload);
              if (json.delta) {
                assistantText += json.delta;
                applyAssistantText();
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

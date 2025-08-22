import React, { createContext, useContext, useState, useCallback } from 'react';

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warn';
  duration?: number;
}

interface NotificationsContextValue {
  push: (t: Omit<Toast, 'id'>) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export const useToasts = () => {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useToasts must be used within NotificationsProvider');
  return ctx;
};

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { duration: 4000, type: 'info', ...t, id };
    setToasts(prev => [...prev, toast]);
    if (toast.duration) {
      setTimeout(() => remove(id), toast.duration);
    }
  }, [remove]);

  return (
    <NotificationsContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}> 
            <span>{t.message}</span>
            <button className="toast-close" onClick={() => remove(t.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
};

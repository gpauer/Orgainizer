import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './global.css';
import { NotificationsProvider } from './components/Notifications';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element with id "root" not found');
}

const root = ReactDOM.createRoot(rootElement as HTMLElement);
root.render(
  <React.StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </React.StrictMode>
);

import axios from 'axios';

// Central axios instance with base URL and auth handling.
const api = axios.create({
  baseURL: 'http://localhost:3001/api'
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    (config.headers as any).token = token;
  }
  return config;
});

let notified = false;
api.interceptors.response.use(
  resp => resp,
  error => {
    if (error.response && error.response.status === 401) {
      // Broadcast a single auth-expired event so app can logout & notify user.
      if (!notified) {
        notified = true;
        window.dispatchEvent(new Event('app:auth-expired'));
        // Reset after slight delay so future expirations can retrigger when user logs back in.
        setTimeout(() => { notified = false; }, 4000);
      }
    }
    return Promise.reject(error);
  }
);

export default api;

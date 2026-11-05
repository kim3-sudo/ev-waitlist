import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The server refuses admin calls until a first-run admin changes their
// passphrase. Tell the auth context so it can send the user to that screen.
api.interceptors.response.use(undefined, (error) => {
  if (error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
    window.dispatchEvent(new Event('auth:password-change-required'));
  }
  return Promise.reject(error);
});

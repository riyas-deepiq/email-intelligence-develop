import axios, { type AxiosInstance } from 'axios';
import { BASE_URL, getToken, setToken, clearToken } from './client';

type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void };

let isRefreshing = false;
let queue: QueueEntry[] = [];

function flushQueue(err: unknown, token: string | null): void {
  queue.forEach((entry) => (err ? entry.reject(err) : entry.resolve(token!)));
  queue = [];
}

function dispatchLogout(): void {
  clearToken();
  window.dispatchEvent(new Event('auth:unauthorized'));
}

export function attachInterceptors(client: AxiosInstance): void {
  client.interceptors.request.use((config) => {
    const token = getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      const original = err.config as (typeof err.config & { _retry?: boolean }) | undefined;
      const status = err.response?.status;

      if (status !== 401 || !original || original._retry) {
        return Promise.reject(err);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({
            resolve: (token) => {
              original.headers.Authorization = `Bearer ${token}`;
              resolve(client(original));
            },
            reject,
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post<{ data: { accessToken: string } }>(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
        );

        const newAccess = data.data.accessToken;
        setToken(newAccess);
        client.defaults.headers.common['Authorization'] = `Bearer ${newAccess}`;

        flushQueue(null, newAccess);
        original.headers.Authorization = `Bearer ${newAccess}`;
        return client(original);
      } catch (refreshErr) {
        flushQueue(refreshErr, null);
        dispatchLogout();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    },
  );
}

import axios from 'axios';
import { attachInterceptors } from './interceptors';

export const BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

let accessToken: string | null = null;

export function getToken(): string | null {
  return accessToken;
}
export function setToken(token: string): void {
  accessToken = token;
}
export function clearToken(): void {
  accessToken = null;
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

attachInterceptors(apiClient);

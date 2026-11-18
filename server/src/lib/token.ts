import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  displayName: string;
  role: string;
  sessionId: string; // ties the JWT to a server-side session for revocation
  type: 'access' | 'refresh'; // prevents refresh tokens from being used as access tokens
}

export function signAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, config.auth.jwtSecret, {
    expiresIn: config.auth.refreshTokenTtlSec as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
  if (payload.type !== 'access') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  const payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
  if (payload.type !== 'refresh') throw new jwt.JsonWebTokenError('Invalid token type');
  return payload;
}

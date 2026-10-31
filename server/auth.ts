import crypto from 'crypto';
import type { Request } from 'express';
import { db, type UserRecord } from './db.ts';

const INSECURE_DEFAULTS = [
  'ecg-ai-secure-jwt-secret-key-2025',
  'ecg-ai-jwt-secret-replace-with-secure-random-key',
  'ecg-ai-jwt-secret-local-development',
  'secret',
  'changeme',
];

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    if (!secret || INSECURE_DEFAULTS.includes(secret) || secret.length < 32) {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: In production mode, JWT_SECRET must be explicitly set to a high-entropy string of at least 32 characters.'
      );
    }
    return secret;
  }
  return secret || 'ecg-ai-dev-jwt-secret-local-development-minimum-32chars';
}

// Sanitize user object for client consumption
export function sanitizeUser(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    username: user.username || user.name,
    email: user.email,
    freeUsageCount: user.freeUsageCount,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    createdAt: user.createdAt,
  };
}

// Password hashing using Node.js crypto.scrypt
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    if (!password || !hash || !salt) return false;
    const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const calcBuf = Buffer.from(calculatedHash, 'hex');
    const hashBuf = Buffer.from(hash, 'hex');
    if (calcBuf.length !== hashBuf.length) return false;
    return crypto.timingSafeEqual(calcBuf, hashBuf);
  } catch {
    return false;
  }
}

// Lightweight JWT implementation using Node.js crypto HMAC SHA256
interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function generateToken(user: UserRecord, expiresInDays = 30): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    iat: now,
    exp: now + expiresInDays * 24 * 60 * 60,
  };

  const secret = resolveJwtSecret();
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const headerJson = base64UrlDecode(encodedHeader);
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const secret = resolveJwtSecret();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadJson = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson) as JwtPayload;
    if (!payload || typeof payload.userId !== 'string' || typeof payload.email !== 'string') {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

// Extract authenticated user from Request
export function getAuthenticatedUser(req: Request): UserRecord | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);
  if (!payload) return null;

  const user = db.getUserById(payload.userId);
  if (!user) return null;

  // Check if subscription has expired
  if (user.subscriptionStatus === 'active' && user.subscriptionExpiresAt) {
    const expiresTime = new Date(user.subscriptionExpiresAt).getTime();
    if (Date.now() > expiresTime) {
      db.updateUser(user.id, { subscriptionStatus: 'expired' });
      user.subscriptionStatus = 'expired';
    }
  }

  return user;
}

import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  statusCode?: number;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = 'Terlalu banyak permintaan dari IP Anda. Silakan coba kembali sesaat lagi.',
    statusCode = 429,
  } = options;

  const hits = new Map<string, ClientRecord>();

  // Periodically cleanup expired entries every 2 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(ip);
      }
    }
  }, 120000);
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Determine client identifier: use req.ip (from trust proxy) or remoteAddress
    const clientKey = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();

    let record = hits.get(clientKey);
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(clientKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      res.status(statusCode).json({
        error: message,
        retryAfterSeconds: resetSeconds,
      });
      return;
    }

    next();
  };
}

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // OWASP ASVS Recommended Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(self "https://app.midtrans.com" "https://app.sandbox.midtrans.com")'
  );

  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://app.sandbox.midtrans.com https://app.midtrans.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.midtrans.com",
    "connect-src 'self' https://app.sandbox.midtrans.com https://app.midtrans.com https://api.sandbox.midtrans.com https://api.midtrans.com",
    "frame-src 'self' https://app.sandbox.midtrans.com https://app.midtrans.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // Add HSTS if request is HTTPS or forwarded as HTTPS
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const DEVICE_ID_REGEX = /^dev_[a-zA-Z0-9_-]{8,64}$/;

export function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function isValidDeviceId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return DEVICE_ID_REGEX.test(id.trim());
}

export function sanitizeText(input: unknown, maxLength = 100): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>'"&]/g, '')
    .trim()
    .slice(0, maxLength);
}

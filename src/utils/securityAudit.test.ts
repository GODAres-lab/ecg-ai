import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  isValidEmail,
  isValidDeviceId,
  sanitizeText,
  createRateLimiter,
  securityHeadersMiddleware,
} from '../../server/security.ts';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  resolveJwtSecret,
} from '../../server/auth.ts';
import { verifyMidtransSignature } from '../../server/midtrans.ts';


test('Security Audit - Email Validation rejects invalid and malicious patterns', () => {
  assert.equal(isValidEmail('doctor@hospital.org'), true);
  assert.equal(isValidEmail('cardiologist.lead@clinic.co.id'), true);

  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('invalid-no-at'), false);
  assert.equal(isValidEmail('user@'), false);
  assert.equal(isValidEmail('@domain.com'), false);
  assert.equal(isValidEmail('<script>alert(1)</script>@domain.com'), false);
  assert.equal(isValidEmail('user@domain..com'), false);
  assert.equal(isValidEmail('a'.repeat(120) + '@domain.com'), false);
});

test('Security Audit - Device ID Validation enforces strict dev_ format and prevents path traversal', () => {
  assert.equal(isValidDeviceId('dev_a1b2c3d4e5f60718'), true);
  assert.equal(isValidDeviceId('dev_user_session_12345'), true);

  assert.equal(isValidDeviceId('../../../etc/passwd'), false);
  assert.equal(isValidDeviceId('dev_../traversal'), false);
  assert.equal(isValidDeviceId('dev_with<script>'), false);
  assert.equal(isValidDeviceId('dev_'), false);
  assert.equal(isValidDeviceId(''), false);
  assert.equal(isValidDeviceId('dev_' + 'x'.repeat(100)), false);
});

test('Security Audit - sanitizeText neutralizes HTML injection and enforces length limits', () => {
  const dirty = '<script>alert("XSS")</script>Dr. John Doe & Partners';
  const cleaned = sanitizeText(dirty, 30);

  assert.equal(cleaned.includes('<'), false);
  assert.equal(cleaned.includes('>'), false);
  assert.equal(cleaned.includes('"'), false);
  assert.equal(cleaned.length <= 30, true);
  assert.equal(cleaned, 'scriptalert(XSS)/scriptDr. Joh');
});

test('Security Audit - JWT rejects altered algorithms, modified payloads, and tampered signatures', () => {
  const mockUser: any = {
    id: 'usr_test_12345678',
    email: 'test@ecg-analyzer.local',
  };

  const validToken = generateToken(mockUser);
  assert.equal(typeof validToken, 'string');
  const verified = verifyToken(validToken);
  assert.notEqual(verified, null);
  assert.equal(verified?.userId, 'usr_test_12345678');

  // Tampered signature
  const parts = validToken.split('.');
  const tamperedSigToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -3)}xyz`;
  assert.equal(verifyToken(tamperedSigToken), null);

  // Tampered payload
  const tamperedPayload = Buffer.from(
    JSON.stringify({ userId: 'usr_admin_fake', email: 'admin@ecg.org', iat: 1000, exp: 9999999999 })
  )
    .toString('base64')
    .replace(/=/g, '');
  const tamperedPayloadToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  assert.equal(verifyToken(tamperedPayloadToken), null);

  // Algorithm 'none' attack attempt
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64')
    .replace(/=/g, '');
  const algNoneToken = `${noneHeader}.${parts[1]}.`;
  assert.equal(verifyToken(algNoneToken), null);

  // Garbage token
  assert.equal(verifyToken('not-a-token'), null);
  assert.equal(verifyToken(''), null);
});

test('Security Audit - Password hashing scrypt verifies correctly and resists timing attacks', () => {
  const { hash, salt } = hashPassword('SecurePass123!@#');
  assert.equal(typeof hash, 'string');
  assert.equal(typeof salt, 'string');
  assert.equal(hash.length, 128); // 64 bytes hex

  assert.equal(verifyPassword('SecurePass123!@#', hash, salt), true);
  assert.equal(verifyPassword('WrongPassword', hash, salt), false);
  assert.equal(verifyPassword('SecurePass123!@#', hash + '00', salt), false); // Length mismatch
  assert.equal(verifyPassword('', hash, salt), false);
});

test('Security Audit - Rate limiter enforces maximum thresholds and returns 429', () => {
  const limiter = createRateLimiter({
    windowMs: 10000,
    max: 3,
    message: 'Rate limit test reached',
  });

  const mockReq: any = { ip: '192.168.1.100', socket: { remoteAddress: '192.168.1.100' } };
  const headers: Record<string, any> = {};
  let statusCode = 200;
  let responseBody: any = null;

  const mockRes: any = {
    setHeader(name: string, value: any) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseBody = data;
      return this;
    },
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  // Call 1
  nextCalled = false;
  limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, true);
  assert.equal(headers['RateLimit-Remaining'], 2);

  // Call 2
  nextCalled = false;
  limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, true);
  assert.equal(headers['RateLimit-Remaining'], 1);

  // Call 3
  nextCalled = false;
  limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, true);
  assert.equal(headers['RateLimit-Remaining'], 0);

  // Call 4 (exceeded limit)
  nextCalled = false;
  limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 429);
  assert.equal(responseBody.error, 'Rate limit test reached');
  assert.ok(headers['Retry-After']);
});

test('Security Audit - Security headers middleware injects OWASP ASVS headers', () => {
  const headers: Record<string, string> = {};
  const mockReq: any = { secure: true, headers: { 'x-forwarded-proto': 'https' } };
  const mockRes: any = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };

  let nextCalled = false;
  securityHeadersMiddleware(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.ok(headers['Content-Security-Policy'].includes("default-src 'self'"));
  assert.ok(headers['Strict-Transport-Security'].includes('max-age=31536000'));
});

test('Security Audit - Midtrans signature verification protects against forged signatures', () => {
  const testServerKey = 'SB-Mid-server-testkey123456';
  const orderId = 'ECG-YEARLY-TEST-123';
  const statusCode = '200';
  const grossAmount = '399000.00';

  // Correct signature calculation
  const validSig = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${testServerKey}`)
    .digest('hex');

  assert.equal(
    verifyMidtransSignature(orderId, statusCode, grossAmount, validSig, testServerKey),
    true
  );

  // Forged signature
  const fakeSig = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}10000.00${testServerKey}`)
    .digest('hex');

  assert.equal(
    verifyMidtransSignature(orderId, statusCode, grossAmount, fakeSig, testServerKey),
    false
  );
});

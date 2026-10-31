import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../../server/auth.ts';
import { verifyMidtransSignature } from '../../server/midtrans.ts';
import { SUBSCRIPTION_PLANS, getPlanById } from '../../server/plans.ts';
import { JsonDatabase, type UserRecord } from '../../server/db.ts';

function createTempDb(): { testDb: JsonDatabase; cleanup: () => void } {
  const tempFile = path.join(
    os.tmpdir(),
    `ecg_ai_test_db_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`
  );
  const testDb = new JsonDatabase(tempFile);
  return {
    testDb,
    cleanup: () => {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Ignore temp file cleanup errors
      }
    },
  };
}

test('Password hashing and verification with scrypt', () => {
  const password = 'SecretPassword123!';
  const { hash, salt } = hashPassword(password);

  assert.ok(hash && hash.length > 0, 'Hash should not be empty');
  assert.ok(salt && salt.length > 0, 'Salt should not be empty');

  const isValid = verifyPassword(password, hash, salt);
  assert.strictEqual(isValid, true, 'Correct password should verify');

  const isInvalid = verifyPassword('WrongPassword', hash, salt);
  assert.strictEqual(isInvalid, false, 'Wrong password should fail verification');
});

test('JWT token generation and verification', () => {
  const dummyUser: UserRecord = {
    id: 'usr_test_123',
    name: 'Dr. Test',
    email: 'test@example.com',
    passwordHash: 'dummy',
    salt: 'dummy',
    freeUsageCount: 2,
    subscriptionStatus: 'active',
    subscriptionPlan: 'monthly',
    subscriptionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const token = generateToken(dummyUser);
  assert.ok(token && token.split('.').length === 3, 'Token should have 3 segments');

  const payload = verifyToken(token);
  assert.ok(payload !== null, 'Token should verify successfully');
  assert.strictEqual(payload?.userId, 'usr_test_123');
  assert.strictEqual(payload?.email, 'test@example.com');

  const corruptedToken = token.slice(0, -5) + 'xxxxx';
  const badPayload = verifyToken(corruptedToken);
  assert.strictEqual(badPayload, null, 'Tampered token signature should fail');
});

test('Subscription plans are defined with monthly and yearly options', () => {
  assert.strictEqual(SUBSCRIPTION_PLANS.length, 2, 'Should have 2 plans');

  const monthly = getPlanById('monthly');
  assert.ok(monthly, 'Monthly plan should exist');
  assert.strictEqual(monthly?.price, 49000);
  assert.strictEqual(monthly?.durationDays, 30);

  const yearly = getPlanById('yearly');
  assert.ok(yearly, 'Yearly plan should exist');
  assert.strictEqual(yearly?.price, 399000);
  assert.strictEqual(yearly?.durationDays, 365);
});

test('Midtrans signature verification logic', () => {
  const orderId = 'ECG-ORDER-123';
  const statusCode = '200';
  const grossAmount = '49000.00';

  const serverKey = process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-sandbox-demo-key';
  const expectedHash = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest('hex');

  const isVerified = verifyMidtransSignature(
    orderId,
    statusCode,
    grossAmount,
    expectedHash,
    serverKey
  );
  assert.strictEqual(isVerified, true, 'Valid Midtrans signature should be verified');

  const isBadVerified = verifyMidtransSignature(
    orderId,
    statusCode,
    grossAmount,
    'bad-signature',
    serverKey
  );
  assert.strictEqual(isBadVerified, false, 'Invalid signature should be rejected');
});

test('Isolated JsonDatabase supports lookup by username, email, and profile updates', () => {
  const { testDb, cleanup } = createTempDb();
  try {
    const uniqueId = `usr_test_${Date.now()}`;
    const username = `doctor_ecg_${Date.now()}`;
    const email = `doctor_${Date.now()}@test.com`;

    testDb.createUser({
      id: uniqueId,
      name: 'Dr. Ahmad',
      username,
      email,
      passwordHash: 'dummy',
      salt: 'dummy',
      freeUsageCount: 0,
      subscriptionStatus: 'none',
      subscriptionPlan: null,
      subscriptionExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    assert.strictEqual(testDb.getUserByUsername(username)?.id, uniqueId);
    assert.strictEqual(testDb.getUserByEmail(email)?.id, uniqueId);
    assert.strictEqual(testDb.getUserByUsernameOrEmail(username)?.id, uniqueId);
    assert.strictEqual(testDb.getUserByUsernameOrEmail(email)?.id, uniqueId);

    const updated = testDb.updateUser(uniqueId, { name: 'Dr. Ahmad Sp.JP' });
    assert.strictEqual(updated?.name, 'Dr. Ahmad Sp.JP');
  } finally {
    cleanup();
  }
});

test('Isolated JsonDatabase supports ephemeral-safe analysis history CRUD', () => {
  const { testDb, cleanup } = createTempDb();
  try {
    const userId = 'usr_history_test';
    testDb.addUserHistory(userId, {
      id: 'ecg_1',
      userId,
      analyzedAt: '2026-10-31T10:00:00.000Z',
      fileName: 'sample_1.png',
      modelUsed: 'AI Multimodal Vision',
      reportLanguage: 'id',
      clinicalContext: { symptoms: 'Palpitasi' },
      report: { urgency_level: 'Normal ECG appearance' },
    });
    testDb.addUserHistory(userId, {
      id: 'ecg_2',
      userId,
      analyzedAt: '2026-10-31T10:05:00.000Z',
      fileName: 'sample_2.png',
      modelUsed: 'AI Multimodal Vision',
      reportLanguage: 'en',
      report: { urgency_level: 'Abnormal ECG' },
    });

    const list = testDb.getUserHistory(userId);
    assert.strictEqual(list.length, 2, 'Should store 2 history items');
    assert.strictEqual(list[0].id, 'ecg_2', 'Newest item should be prepended first');

    const removed = testDb.deleteUserHistoryItem(userId, 'ecg_1');
    assert.strictEqual(removed, true, 'Deleting existing item should return true');
    assert.strictEqual(testDb.getUserHistory(userId).length, 1);

    testDb.clearUserHistory(userId);
    assert.strictEqual(testDb.getUserHistory(userId).length, 0, 'Clearing should empty history');
  } finally {
    cleanup();
  }
});

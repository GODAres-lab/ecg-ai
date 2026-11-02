import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data');
const DEFAULT_DB_FILE = path.join(DEFAULT_DATA_DIR, 'db.json');

export interface UserRecord {
  id: string;
  name: string;
  username?: string;
  email: string;
  passwordHash: string;
  salt: string;
  freeUsageCount: number;
  subscriptionStatus: 'none' | 'active' | 'expired';
  subscriptionPlan: 'monthly' | 'yearly' | null;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceUsageRecord {
  deviceId: string;
  usageCount: number;
  firstUsedAt: string;
  lastUsedAt: string;
  linkedUserId: string | null;
}

export interface TransactionRecord {
  orderId: string;
  userId: string;
  planId: 'monthly' | 'yearly';
  amount: number;
  status: 'pending' | 'settlement' | 'expire' | 'cancel' | 'deny';
  snapToken: string;
  snapRedirectUrl: string;
  paymentType: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  rawNotification?: any;
}

export interface AnalysisHistoryRecord {
  id: string;
  userId: string;
  analyzedAt: string;
  fileName: string;
  modelUsed: string;
  reportLanguage?: 'id' | 'en';
  clinicalContext?: {
    patientAgeSex?: string;
    symptoms?: string;
    clinicalHistory?: string;
  };
  verification?: any;
  report: any;
}

interface DatabaseSchema {
  users: Record<string, UserRecord>;
  devices: Record<string, DeviceUsageRecord>;
  transactions: Record<string, TransactionRecord>;
  history: Record<string, AnalysisHistoryRecord[]>;
}

function createEmptyDb(): DatabaseSchema {
  return {
    users: {},
    devices: {},
    transactions: {},
    history: {},
  };
}

export class JsonDatabase {
  private data: DatabaseSchema = createEmptyDb();
  private lastMtime = 0;
  private activeFilePath = '';
  private customFilePath?: string;

  constructor(customFilePath?: string) {
    this.customFilePath = customFilePath;
  }

  private resolveDbFile(): string {
    if (this.customFilePath) return this.customFilePath;
    if (process.env.ECG_DB_FILE && process.env.ECG_DB_FILE.trim().length > 0) {
      return path.resolve(process.env.ECG_DB_FILE.trim());
    }
    return DEFAULT_DB_FILE;
  }

  private ensureDir(filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    const dbFile = this.resolveDbFile();
    if (this.activeFilePath !== dbFile) {
      this.activeFilePath = dbFile;
      this.lastMtime = 0;
    }

    this.ensureDir(dbFile);
    if (fs.existsSync(dbFile)) {
      try {
        const stat = fs.statSync(dbFile);
        if (stat.mtimeMs <= this.lastMtime && this.lastMtime > 0) {
          return;
        }
        const raw = fs.readFileSync(dbFile, 'utf-8');
        this.data = JSON.parse(raw);
        if (!this.data.users) this.data.users = {};
        if (!this.data.devices) this.data.devices = {};
        if (!this.data.transactions) this.data.transactions = {};
        if (!this.data.history) this.data.history = {};
        this.lastMtime = stat.mtimeMs;
      } catch (err) {
        console.error('Failed to parse database file, initializing clean DB:', err);
        this.data = createEmptyDb();
        this.save();
      }
    } else {
      this.data = createEmptyDb();
      this.save();
    }
  }

  private save(): void {
    const dbFile = this.resolveDbFile();
    this.ensureDir(dbFile);
    const tempFile = `${dbFile}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tempFile, dbFile);
    if (fs.existsSync(dbFile)) {
      this.lastMtime = fs.statSync(dbFile).mtimeMs;
      this.activeFilePath = dbFile;
    }
  }

  // User operations
  getUserById(id: string): UserRecord | null {
    this.load();
    return this.data.users[id] || null;
  }

  getUserByEmail(email: string): UserRecord | null {
    this.load();
    const normalized = email.trim().toLowerCase();
    for (const user of Object.values(this.data.users)) {
      if (user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    return null;
  }

  getUserByUsername(username: string): UserRecord | null {
    this.load();
    const normalized = username.trim().toLowerCase();
    for (const user of Object.values(this.data.users)) {
      if (
        (user.username && user.username.toLowerCase() === normalized) ||
        (!user.username && user.name.toLowerCase() === normalized)
      ) {
        return user;
      }
    }
    return null;
  }

  getUserByUsernameOrEmail(identifier: string): UserRecord | null {
    this.load();
    const normalized = identifier.trim().toLowerCase();
    for (const user of Object.values(this.data.users)) {
      if (
        user.email.toLowerCase() === normalized ||
        (user.username && user.username.toLowerCase() === normalized) ||
        user.name.toLowerCase() === normalized
      ) {
        return user;
      }
    }
    return null;
  }

  createUser(user: UserRecord): UserRecord {
    this.load();
    this.data.users[user.id] = user;
    this.save();
    return user;
  }

  updateUser(id: string, updates: Partial<UserRecord>): UserRecord | null {
    this.load();
    const current = this.data.users[id];
    if (!current) return null;
    const updated: UserRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.data.users[id] = updated;
    this.save();
    return updated;
  }

  // Device usage operations (for guest/unregistered users)
  getDeviceUsage(deviceId: string): DeviceUsageRecord {
    this.load();
    if (!this.data.devices[deviceId]) {
      const keys = Object.keys(this.data.devices);
      // Evict oldest devices if capacity exceeds 5,000 entries
      if (keys.length >= 5000) {
        const sorted = keys.sort((a, b) => {
          const tA = new Date(this.data.devices[a].lastUsedAt || 0).getTime();
          const tB = new Date(this.data.devices[b].lastUsedAt || 0).getTime();
          return tA - tB;
        });
        for (let i = 0; i < 500; i++) {
          delete this.data.devices[sorted[i]];
        }
      }

      this.data.devices[deviceId] = {
        deviceId,
        usageCount: 0,
        firstUsedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        linkedUserId: null,
      };
      this.save();
    }
    return this.data.devices[deviceId];
  }

  incrementDeviceUsage(deviceId: string): DeviceUsageRecord {
    this.load();
    const current = this.getDeviceUsage(deviceId);
    current.usageCount += 1;
    current.lastUsedAt = new Date().toISOString();
    this.data.devices[deviceId] = current;
    this.save();
    return current;
  }

  linkDeviceToUser(deviceId: string, userId: string): void {
    this.load();
    const current = this.getDeviceUsage(deviceId);
    current.linkedUserId = userId;
    this.save();
  }

  // Transactions
  createTransaction(tx: TransactionRecord): TransactionRecord {
    this.load();
    this.data.transactions[tx.orderId] = tx;
    this.save();
    return tx;
  }

  getTransaction(orderId: string): TransactionRecord | null {
    this.load();
    return this.data.transactions[orderId] || null;
  }

  updateTransaction(orderId: string, updates: Partial<TransactionRecord>): TransactionRecord | null {
    this.load();
    const current = this.data.transactions[orderId];
    if (!current) return null;
    const updated: TransactionRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.data.transactions[orderId] = updated;
    this.save();
    return updated;
  }

  getUserTransactions(userId: string): TransactionRecord[] {
    this.load();
    return Object.values(this.data.transactions)
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Ephemeral-image-safe Analysis Report History (stores structured report metadata only, never raw patient photos)
  addUserHistory(userId: string, record: AnalysisHistoryRecord): AnalysisHistoryRecord {
    this.load();
    const list = Array.isArray(this.data.history[userId]) ? this.data.history[userId] : [];
    const filtered = list.filter((item) => item.id !== record.id);
    this.data.history[userId] = [record, ...filtered].slice(0, 40);
    this.save();
    return record;
  }

  getUserHistory(userId: string): AnalysisHistoryRecord[] {
    this.load();
    const list = this.data.history[userId];
    return Array.isArray(list) ? list : [];
  }

  deleteUserHistoryItem(userId: string, recordId: string): boolean {
    this.load();
    const list = this.data.history[userId];
    if (!Array.isArray(list)) return false;
    const next = list.filter((item) => item.id !== recordId);
    if (next.length === list.length) return false;
    this.data.history[userId] = next;
    this.save();
    return true;
  }

  clearUserHistory(userId: string): void {
    this.load();
    this.data.history[userId] = [];
    this.save();
  }
}

export const db = new JsonDatabase();

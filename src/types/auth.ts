export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  freeUsageCount: number;
  subscriptionStatus: 'none' | 'active' | 'expired';
  subscriptionPlan: string | null;
  subscriptionExpiresAt: string | null;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface QuotaInfo {
  isAuthenticated: boolean;
  usageCount: number;
  remainingQuota: number;
  maxFreeLimit: number;
  isSubscribed: boolean;
  subscriptionStatus: 'none' | 'active' | 'expired';
  subscriptionExpiresAt: string | null;
  subscriptionPlan: string | null;
}

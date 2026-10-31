export interface SubscriptionPlan {
  id: 'monthly' | 'yearly';
  name: string;
  tagline: string;
  price: number;
  formattedPrice: string;
  period: string;
  durationDays: number;
  popular?: boolean;
  savingsBadge?: string;
  features: string[];
}

export interface PaymentTransaction {
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
}

export interface MidtransConfig {
  clientKey: string;
  isProduction: boolean;
  isConfigured: boolean;
}

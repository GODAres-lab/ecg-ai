import crypto from 'crypto';

export interface CreateSnapTransactionParams {
  orderId: string;
  grossAmount: number;
  customerName: string;
  customerEmail: string;
  planName: string;
  planId: string;
}

export interface SnapTransactionResult {
  token: string;
  redirectUrl: string;
  isSimulated?: boolean;
}

export function isMidtransConfigured(): boolean {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey || serverKey.trim().length === 0) return false;
  const isPlaceholder =
    serverKey === 'MY_MIDTRANS_SERVER_KEY' ||
    serverKey.includes('YOUR_SERVER_KEY') ||
    serverKey.includes('sandbox-demo') ||
    serverKey.includes('SB-Mid-server-...');
  return !isPlaceholder;
}

export function getMidtransConfig() {
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const clientKey = process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-demo';
  const serverKey = process.env.MIDTRANS_SERVER_KEY || '';

  const snapBaseUrl = isProduction
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1';

  const apiBaseUrl = isProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';

  return {
    isProduction,
    clientKey,
    serverKey,
    snapBaseUrl,
    apiBaseUrl,
    isConfigured: isMidtransConfigured(),
  };
}

export async function createMidtransSnapTransaction(
  params: CreateSnapTransactionParams
): Promise<SnapTransactionResult> {
  const config = getMidtransConfig();

  // If Midtrans credentials are not configured yet, generate a safe dev mock token
  // so the developer / user can test the workflow immediately
  if (!config.isConfigured) {
    console.warn(
      'MIDTRANS_SERVER_KEY is not configured or using default placeholder. Using simulated sandbox token.'
    );
    return {
      token: `SIMULATED_SNAP_${params.orderId}_${Date.now()}`,
      redirectUrl: `https://app.sandbox.midtrans.com/snap/v2/vtweb/simulated-${params.orderId}`,
      isSimulated: true,
    };
  }

  const authHeader = `Basic ${Buffer.from(`${config.serverKey}:`).toString('base64')}`;

  const payload = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.grossAmount,
    },
    customer_details: {
      first_name: params.customerName,
      email: params.customerEmail,
    },
    item_details: [
      {
        id: params.planId,
        price: params.grossAmount,
        quantity: 1,
        name: params.planName,
      },
    ],
    credit_card: {
      secure: true,
    },
    callbacks: {
      finish: `${process.env.APP_URL || 'http://localhost:3000'}/?payment=success&order_id=${params.orderId}`,
      error: `${process.env.APP_URL || 'http://localhost:3000'}/?payment=error&order_id=${params.orderId}`,
      close: `${process.env.APP_URL || 'http://localhost:3000'}/?payment=cancelled&order_id=${params.orderId}`,
    },
  };

  const response = await fetch(`${config.snapBaseUrl}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Midtrans Snap API Error:', response.status, errorText);
    if (response.status === 401 || response.status === 403) {
      console.warn(
        'Midtrans API credentials returned 401/403. Falling back to development sandbox simulated transaction.'
      );
      return {
        token: `SIMULATED_SNAP_${params.orderId}_${Date.now()}`,
        redirectUrl: `https://app.sandbox.midtrans.com/snap/v2/vtweb/simulated-${params.orderId}`,
        isSimulated: true,
      };
    }
    throw new Error(`Midtrans API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { token: string; redirect_url: string };
  return {
    token: data.token,
    redirectUrl: data.redirect_url,
    isSimulated: false,
  };
}

export function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string | number,
  signatureKey: string,
  serverKeyOverride?: string
): boolean {
  const config = getMidtransConfig();
  const serverKey = serverKeyOverride || config.serverKey;
  if (!serverKey || !orderId || !statusCode || grossAmount === undefined || !signatureKey) return false;

  // Midtrans signature formula: SHA512(order_id + status_code + gross_amount + ServerKey)
  // gross_amount might need formatting e.g. "49000.00" or raw string
  const strAmount = typeof grossAmount === 'number' ? grossAmount.toFixed(2) : String(grossAmount);

  const hashWithDecimals = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${strAmount}${serverKey}`)
    .digest('hex');

  const rawAmountStr = String(grossAmount).split('.')[0];
  const hashWithoutDecimals = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${rawAmountStr}${serverKey}`)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signatureKey, 'utf8');
    const decBuf = Buffer.from(hashWithDecimals, 'utf8');
    const rawBuf = Buffer.from(hashWithoutDecimals, 'utf8');

    const matchDec = sigBuf.length === decBuf.length && crypto.timingSafeEqual(sigBuf, decBuf);
    const matchRaw = sigBuf.length === rawBuf.length && crypto.timingSafeEqual(sigBuf, rawBuf);

    return matchDec || matchRaw;
  } catch {
    return false;
  }
}

export async function checkMidtransOrderStatus(orderId: string): Promise<any> {
  const config = getMidtransConfig();
  if (!config.isConfigured) {
    return {
      transaction_status: 'settlement',
      order_id: orderId,
      isSimulated: true,
    };
  }

  const authHeader = `Basic ${Buffer.from(`${config.serverKey}:`).toString('base64')}`;

  const response = await fetch(`${config.apiBaseUrl}/${orderId}/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    throw new Error(`Midtrans status check failed with HTTP ${response.status}`);
  }

  return await response.json();
}

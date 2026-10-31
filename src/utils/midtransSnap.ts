import { apiFetch } from './authStorage';
import type { MidtransConfig } from '../types/subscription';

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options: {
          onSuccess?: (result: any) => void;
          onPending?: (result: any) => void;
          onError?: (result: any) => void;
          onClose?: () => void;
        }
      ) => void;
    };
  }
}

let midtransConfigPromise: Promise<MidtransConfig> | null = null;

export async function fetchMidtransConfig(): Promise<MidtransConfig> {
  if (midtransConfigPromise) {
    return midtransConfigPromise;
  }

  midtransConfigPromise = apiFetch('/api/config/midtrans')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch Midtrans config');
      return res.json() as Promise<MidtransConfig>;
    })
    .catch((err) => {
      console.warn('Failed to load Midtrans config, using default fallback:', err);
      return {
        clientKey: 'SB-Mid-client-demo',
        isProduction: false,
        isConfigured: false,
      };
    });

  return midtransConfigPromise;
}

export async function loadMidtransSnapScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // Check if snap is already available on window
  if (window.snap) {
    return true;
  }

  const existingScript = document.getElementById('midtrans-snap-script') as HTMLScriptElement | null;
  if (existingScript) {
    if (window.snap) return true;
    return new Promise((resolve) => {
      let attempts = 0;
      const interval = setInterval(() => {
        if (window.snap) {
          clearInterval(interval);
          resolve(true);
        } else if (++attempts > 30) {
          clearInterval(interval);
          resolve(false);
        }
      }, 100);

      existingScript.addEventListener('load', () => {
        clearInterval(interval);
        resolve(true);
      });
      existingScript.addEventListener('error', () => {
        clearInterval(interval);
        resolve(false);
      });
    });
  }

  try {
    const config = await fetchMidtransConfig();
    const scriptUrl = config.isProduction
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js';

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.id = 'midtrans-snap-script';
      script.src = scriptUrl;
      script.setAttribute('data-client-key', config.clientKey || 'SB-Mid-client-demo');
      script.async = true;

      script.onload = () => {
        resolve(true);
      };

      script.onerror = () => {
        console.warn('Failed to load Midtrans Snap script from', scriptUrl);
        resolve(false);
      };

      document.head.appendChild(script);
    });
  } catch (err) {
    console.error('Error in loadMidtransSnapScript:', err);
    return false;
  }
}

export interface SnapPayCallbacks {
  onSuccess: (result: any) => void;
  onPending?: (result: any) => void;
  onError?: (result: any) => void;
  onClose?: () => void;
}

export async function triggerSnapPay(
  token: string,
  callbacks: SnapPayCallbacks
): Promise<void> {
  const loaded = await loadMidtransSnapScript();
  if (loaded && window.snap) {
    window.snap.pay(token, callbacks);
  } else {
    // If Snap script couldn't be loaded (e.g. offline or simulated), fallback cleanly
    console.warn('Midtrans Snap is not available on window. Falling back to callback or simulated handler.');
    if (token.startsWith('SIMULATED_SNAP_')) {
      callbacks.onSuccess({
        transaction_status: 'settlement',
        order_id: token.replace('SIMULATED_SNAP_', ''),
        simulated: true,
      });
    } else {
      alert(
        'Sistem Midtrans Snap sedang memuat atau tidak dapat diakses langsung. Anda akan diarahkan ke konfirmasi pembayaran.'
      );
      callbacks.onPending?.({ token });
    }
  }
}

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  User as UserIcon,
  Crown,
  CreditCard,
  Lock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Calendar,
} from 'lucide-react';
import type { User, QuotaInfo } from '../types/auth';
import type { PaymentTransaction } from '../types/subscription';
import type { UiLanguage } from '../types/ecg';
import { apiFetch } from '../utils/authStorage';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  quotaInfo: QuotaInfo | null;
  onUserUpdated: (user: User) => void;
  onOpenSubscribe: () => void;
  uiLang: UiLanguage;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  quotaInfo,
  onUserUpdated,
  onOpenSubscribe,
  uiLang,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'billing'>('profile');
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [verifyingOrderId, setVerifyingOrderId] = useState<string | null>(null);
  const [billingNotice, setBillingNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const loadTransactions = useCallback(async () => {
    if (!currentUser) return;
    setIsLoadingTx(true);
    try {
      const res = await apiFetch('/api/user/transactions');
      if (res.ok) {
        const data = await res.json();
        setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
      }
    } catch {
      // Ignore network error
    } finally {
      setIsLoadingTx(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isOpen && currentUser) {
      setDisplayName(currentUser.name || currentUser.username || '');
      setCurrentPassword('');
      setNewPassword('');
      setProfileNotice(null);
      setBillingNotice(null);
      loadTransactions();
    }
  }, [isOpen, currentUser, loadTransactions]);

  if (!isOpen || !currentUser) return null;

  const isSubscribed =
    quotaInfo?.isSubscribed || currentUser.subscriptionStatus === 'active';

  const daysRemaining = (() => {
    if (!currentUser.subscriptionExpiresAt) return null;
    const diff = new Date(currentUser.subscriptionExpiresAt).getTime() - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileNotice(null);
    setIsSavingProfile(true);

    try {
      const payload: Record<string, string> = {};
      if (displayName.trim() && displayName.trim() !== currentUser.name) {
        payload.name = displayName.trim();
      }
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      if (Object.keys(payload).length === 0) {
        setProfileNotice({
          type: 'error',
          text:
            uiLang === 'id'
              ? 'Tidak ada perubahan nama atau kata sandi untuk disimpan.'
              : 'No display name or password changes to save.',
        });
        setIsSavingProfile(false);
        return;
      }

      const res = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal memperbarui profil.');
      }

      if (data?.user) {
        onUserUpdated(data.user);
      }
      setCurrentPassword('');
      setNewPassword('');
      setProfileNotice({
        type: 'success',
        text:
          uiLang === 'id'
            ? 'Profil akun Anda berhasil diperbarui.'
            : 'Your account profile has been updated.',
      });
    } catch (err: unknown) {
      setProfileNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memperbarui profil.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleVerifyOrder = async (orderId: string) => {
    setBillingNotice(null);
    setVerifyingOrderId(orderId);
    try {
      const res = await apiFetch(`/api/subscription/verify-order/${orderId}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data?.user) {
        onUserUpdated(data.user);
        await loadTransactions();
        setBillingNotice({
          type: 'success',
          text:
            uiLang === 'id'
              ? `Pembayaran ${orderId} terkonfirmasi! Paket Pro Anda telah aktif.`
              : `Payment ${orderId} verified! Your Pro subscription is now active.`,
        });
      } else {
        await loadTransactions();
        setBillingNotice({
          type: 'info',
          text:
            data?.message ||
            (uiLang === 'id'
              ? 'Pembayaran masih menunggu penyelesaian di Midtrans.'
              : 'Payment is still awaiting settlement in Midtrans.'),
        });
      }
    } catch {
      setBillingNotice({
        type: 'error',
        text:
          uiLang === 'id'
            ? 'Gagal memeriksa status transaksi ke server.'
            : 'Failed to verify transaction status.',
      });
    } finally {
      setVerifyingOrderId(null);
    }
  };

  const formatRupiah = (amount: number) =>
    new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-8">
        {/* Top Profile Banner */}
        <div className="bg-slate-900 text-white px-6 py-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
              {(currentUser.username || currentUser.name).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold truncate">
                  {currentUser.name || currentUser.username}
                </h2>
                {isSubscribed ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    <Crown className="w-3 h-3 fill-emerald-300 text-emerald-300" />
                    PRO AKTIF
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-slate-300">
                    {uiLang === 'id' ? 'Akun Gratis' : 'Free Tier'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                @{currentUser.username || currentUser.name} • {currentUser.email}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-4 border-b border-slate-100 flex gap-6 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`pb-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'Profil & Langganan' : 'Profile & Subscription'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('billing')}
            className={`pb-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'billing'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>
              {uiLang === 'id'
                ? `Riwayat Pembayaran (${transactions.length})`
                : `Payment History (${transactions.length})`}
            </span>
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'profile' ? (
            <div className="space-y-6">
              {/* Subscription Status Card */}
              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isSubscribed
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Crown
                      className={`w-4 h-4 ${
                        isSubscribed ? 'text-emerald-600 fill-emerald-600' : 'text-amber-500'
                      }`}
                    />
                    <span>
                      {isSubscribed
                        ? currentUser.subscriptionPlan === 'yearly'
                          ? 'Paket Pro Tahunan (Unlimited)'
                          : 'Paket Pro Bulanan (Unlimited)'
                        : uiLang === 'id'
                          ? `Kuota Gratis Terpakai: ${currentUser.freeUsageCount} dari 3 Analisis`
                          : `Free Quota Used: ${currentUser.freeUsageCount} of 3 Analyses`}
                    </span>
                  </div>
                  {isSubscribed && currentUser.subscriptionExpiresAt ? (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                      <span>
                        {uiLang === 'id' ? 'Aktif hingga' : 'Active until'}{' '}
                        <strong>
                          {new Date(currentUser.subscriptionExpiresAt).toLocaleDateString(
                            uiLang === 'id' ? 'id-ID' : 'en-US',
                            { day: 'numeric', month: 'long', year: 'numeric' }
                          )}
                        </strong>{' '}
                        ({daysRemaining} {uiLang === 'id' ? 'hari tersisa' : 'days left'})
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {uiLang === 'id'
                        ? 'Tingkatkan ke Paket Pro untuk akses interpretasi EKG 12-lead tanpa batas.'
                        : 'Upgrade to Pro for unlimited 12-lead ECG interpretations.'}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSubscribe();
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isSubscribed
                    ? uiLang === 'id'
                      ? 'Perpanjang Paket'
                      : 'Extend Plan'
                    : uiLang === 'id'
                      ? 'Upgrade ke Pro'
                      : 'Upgrade to Pro'}
                </button>
              </div>

              {/* Edit Profile & Password Form */}
              <form onSubmit={handleSaveProfile} className="space-y-4">
                {profileNotice && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      profileNotice.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {profileNotice.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{profileNotice.text}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {uiLang === 'id' ? 'Nama Tampilan / Gelar Klinis' : 'Display Name / Title'}
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Contoh: dr. Ahmad Fauzi"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-3">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {uiLang === 'id'
                        ? 'Ubah Kata Sandi (Opsional)'
                        : 'Change Password (Optional)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {uiLang === 'id' ? 'Kata Sandi Saat Ini' : 'Current Password'}
                      </label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {uiLang === 'id' ? 'Kata Sandi Baru (Min. 6 Karakter)' : 'New Password (Min. 6 chars)'}
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{uiLang === 'id' ? 'Simpan Perubahan Profil' : 'Save Profile Changes'}</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              {billingNotice && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    billingNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : billingNotice.type === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-blue-50 border-blue-200 text-blue-800'
                  }`}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{billingNotice.text}</span>
                </div>
              )}

              {isLoadingTx ? (
                <div className="py-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{uiLang === 'id' ? 'Memuat riwayat transaksi...' : 'Loading transactions...'}</span>
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <CreditCard className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs text-slate-500">
                    {uiLang === 'id'
                      ? 'Belum ada riwayat transaksi langganan pada akun ini.'
                      : 'No subscription transactions recorded for this account yet.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {transactions.map((tx) => {
                    const isSettled = tx.status === 'settlement';
                    const isPending = tx.status === 'pending';
                    const isSimulatedUrl = tx.snapRedirectUrl?.includes('/simulated-');

                    return (
                      <div
                        key={tx.orderId}
                        className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {tx.orderId}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                isSettled
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isPending
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {isSettled
                                ? uiLang === 'id'
                                  ? 'Lunas'
                                  : 'Settled'
                                : isPending
                                  ? uiLang === 'id'
                                    ? 'Menunggu'
                                    : 'Pending'
                                  : tx.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 font-medium">
                            {tx.planId === 'yearly' ? 'Paket Pro Tahunan' : 'Paket Pro Bulanan'} —{' '}
                            <strong>{formatRupiah(tx.amount)}</strong>
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            {new Date(tx.createdAt).toLocaleString(
                              uiLang === 'id' ? 'id-ID' : 'en-US'
                            )}
                          </p>
                        </div>

                        {isPending && (
                          <div className="flex items-center gap-2 shrink-0">
                            {tx.snapRedirectUrl && !isSimulatedUrl && (
                              <a
                                href={tx.snapRedirectUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-semibold rounded-xl transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>{uiLang === 'id' ? 'Bayar' : 'Pay'}</span>
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={verifyingOrderId === tx.orderId}
                              onClick={() => handleVerifyOrder(tx.orderId)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  verifyingOrderId === tx.orderId ? 'animate-spin' : ''
                                }`}
                              />
                              <span>{uiLang === 'id' ? 'Cek Status' : 'Verify'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


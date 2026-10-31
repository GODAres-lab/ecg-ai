import React, { useState } from 'react';
import {
  X,
  Crown,
  Check,
  Zap,
  ShieldCheck,
  CreditCard,
  QrCode,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Calendar,
} from 'lucide-react';
import { apiFetch } from '../utils/authStorage';
import { triggerSnapPay, fetchMidtransConfig } from '../utils/midtransSnap';
import type { User } from '../types/auth';
import type { UiLanguage } from '../types/ecg';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onOpenAuth: () => void;
  onSubscriptionActivated: (updatedUser: User) => void;
  uiLang?: UiLanguage;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenAuth,
  onSubscriptionActivated,
  uiLang = 'id',
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState<'monthly' | 'yearly'>('yearly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBeginnerGuide, setShowBeginnerGuide] = useState(false);
  const [useSnapPopup, setUseSnapPopup] = useState<boolean>(true);
  const [pendingOrder, setPendingOrder] = useState<{
    orderId: string;
    planId: 'monthly' | 'yearly';
    planName: string;
    snapToken: string;
    snapRedirectUrl?: string;
    isSimulated?: boolean;
  } | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ planName: string; expiresAt: string } | null>(
    null
  );

  if (!isOpen) return null;

  const isAlreadyActive = currentUser?.subscriptionStatus === 'active';

  const handleVerifyPendingOrder = async (orderId: string) => {
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      const verifyRes = await apiFetch(`/api/subscription/verify-order/${orderId}`, {
        method: 'POST',
      });
      const verifyData = await verifyRes.json();
      if (verifyData?.success && verifyData?.user) {
        setPendingOrder(null);
        setSuccessInfo({
          planName: selectedPlanId === 'yearly' ? 'Paket Pro Tahunan' : 'Paket Pro Bulanan',
          expiresAt: verifyData.user.subscriptionExpiresAt,
        });
        onSubscriptionActivated(verifyData.user);
      } else {
        throw new Error(
          verifyData?.message ||
            (uiLang === 'id'
              ? 'Pembayaran belum terkonfirmasi di Midtrans Snap.'
              : 'Payment has not been confirmed by Midtrans Snap yet.')
        );
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : uiLang === 'id'
            ? 'Gagal memverifikasi status pembayaran Midtrans.'
            : 'Failed to verify Midtrans payment status.';
      setErrorMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubscribe = async () => {
    setErrorMessage(null);

    if (!currentUser) {
      onClose();
      onOpenAuth();
      return;
    }

    setIsProcessing(true);

    try {
      // Only reuse pendingOrder if it matches the currently selected planId!
      let activeOrder =
        pendingOrder && pendingOrder.planId === selectedPlanId ? pendingOrder : null;

      if (!activeOrder) {
        const res = await apiFetch('/api/subscription/create-transaction', {
          method: 'POST',
          body: JSON.stringify({ planId: selectedPlanId }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || 'Gagal menyiapkan transaksi Midtrans Snap.');
        }

        activeOrder = {
          orderId: data.orderId,
          planId: selectedPlanId,
          planName:
            data.plan?.name ||
            (selectedPlanId === 'yearly' ? 'Paket Pro Tahunan' : 'Paket Pro Bulanan'),
          snapToken: data.snapToken || '',
          snapRedirectUrl: data.snapRedirectUrl,
          isSimulated: Boolean(data.isSimulated),
        };
        setPendingOrder(activeOrder);
      }

      // If running in local dev mode without Midtrans API keys configured, verify directly instead of opening a 404 URL
      if (activeOrder.isSimulated) {
        await handleVerifyPendingOrder(activeOrder.orderId);
        return;
      }

      const midtransConf = await fetchMidtransConfig();

      if (useSnapPopup && midtransConf.isConfigured && activeOrder.snapToken) {
        await triggerSnapPay(activeOrder.snapToken, {
          onSuccess: () => {
            handleVerifyPendingOrder(activeOrder!.orderId);
          },
          onPending: () => {
            // Keep pendingOrder banner visible so user can click "Cek Status" anytime
          },
          onError: () => {
            setErrorMessage(
              uiLang === 'id'
                ? 'Terjadi kendala pada jendela Midtrans Snap. Anda juga dapat membuka link pembayaran langsung di bawah.'
                : 'An error occurred in Midtrans Snap. You can also open the direct payment portal link below.'
            );
          },
          onClose: () => {
            // User closed popup without finishing; pending banner stays available
          },
        });
      } else if (activeOrder.snapRedirectUrl) {
        const win = window.open(activeOrder.snapRedirectUrl, '_blank', 'noopener,noreferrer');
        if (!win) {
          window.location.href = activeOrder.snapRedirectUrl;
        }
      } else {
        throw new Error('URL pembayaran Midtrans Snap tidak ditemukan.');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Terjadi kegagalan saat menghubungi Midtrans Snap.';
      setErrorMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-8">
        {/* Modal Header */}
        <div className="relative bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white px-6 py-7">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-2 text-amber-400 text-xs font-bold tracking-wider uppercase">
            <Crown className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span>AI ECG Analyzer Pro Subscription</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {uiLang === 'id'
              ? 'Akses Interpretasi EKG Tanpa Batas'
              : 'Unlimited 12-Lead ECG Interpretation'}
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-300 max-w-lg leading-relaxed">
            {uiLang === 'id'
              ? 'Buka akses penuh analisis EKG 12-lead multimodal, kompas aksis hexaxial, riwayat tersinkronisasi, dan ekspor laporan PDF medis.'
              : 'Unlock unlimited multimodal 12-lead ECG analysis, hexaxial axis compass, synced report history, and clinical A4 PDF exports.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" /> Midtrans Official Gateway
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 font-medium">
              <QrCode className="w-3.5 h-3.5 text-emerald-400" /> QRIS, GoPay, VA Bank, Kartu
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 font-medium">
              <Zap className="w-3.5 h-3.5 text-amber-400" />{' '}
              {uiLang === 'id' ? 'Aktivasi Otomatis Instan' : 'Instant Auto-Activation'}
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-7 space-y-5">
          {successInfo ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                {uiLang === 'id'
                  ? 'Selamat! Langganan Pro Berhasil Diaktifkan'
                  : 'Pro Subscription Successfully Activated!'}
              </h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                {uiLang === 'id'
                  ? 'Akun Anda kini memiliki akses penuh tanpa batas ke seluruh fitur analisis EKG AI.'
                  : 'Your account now has unlimited access to all AI ECG clinical analysis features.'}
                {successInfo.expiresAt && (
                  <span className="block mt-1.5 font-semibold text-slate-800">
                    {uiLang === 'id' ? 'Masa aktif hingga: ' : 'Active until: '}
                    {new Date(successInfo.expiresAt).toLocaleDateString(
                      uiLang === 'id' ? 'id-ID' : 'en-US',
                      { day: 'numeric', month: 'long', year: 'numeric' }
                    )}
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSuccessInfo(null);
                  onClose();
                }}
                className="mt-4 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md transition-colors cursor-pointer"
              >
                {uiLang === 'id' ? 'Mulai Analisis EKG Sekarang' : 'Start ECG Analysis Now'}
              </button>
            </div>
          ) : (
            <>
              {/* Active Subscription Notice if already subscribed */}
              {isAlreadyActive && currentUser?.subscriptionExpiresAt && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-xs text-emerald-900">
                  <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {uiLang === 'id'
                      ? 'Paket Pro Anda saat ini aktif hingga '
                      : 'Your Pro plan is currently active until '}
                    <strong>
                      {new Date(currentUser.subscriptionExpiresAt).toLocaleDateString(
                        uiLang === 'id' ? 'id-ID' : 'en-US',
                        { day: 'numeric', month: 'long', year: 'numeric' }
                      )}
                    </strong>
                    .{' '}
                    {uiLang === 'id'
                      ? 'Pembelian baru akan otomatis menambah durasi masa aktif Anda.'
                      : 'Purchasing again will extend your active expiration date.'}
                  </span>
                </div>
              )}

              {errorMessage && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{errorMessage}</p>
                </div>
              )}

              {/* Plan Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Monthly Plan */}
                <div
                  onClick={() => setSelectedPlanId('monthly')}
                  className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    selectedPlanId === 'monthly'
                      ? 'border-blue-600 bg-blue-50/40 shadow-md ring-2 ring-blue-600/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-slate-900">
                        {uiLang === 'id' ? 'Paket Bulanan' : 'Monthly Plan'}
                      </span>
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlanId === 'monthly'
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-300'
                        }`}
                      >
                        {selectedPlanId === 'monthly' && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                      {uiLang === 'id'
                        ? 'Akses fleksibel 30 hari penuh'
                        : 'Flexible 30-day unlimited access'}
                    </p>
                    <div className="mb-4">
                      <span className="text-2xl font-extrabold text-slate-900">Rp 49.000</span>
                      <span className="text-xs font-semibold text-slate-500">
                        {uiLang === 'id' ? ' / bulan' : ' / month'}
                      </span>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-600">
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Analisis EKG 12-Lead Tanpa Batas'
                            : 'Unlimited 12-Lead ECG Analyses'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Kompas Aksis & Kalkulator QTc Klinis'
                            : 'Hexaxial Compass & QTc Calculator'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Riwayat & Ekspor Laporan PDF A4'
                            : 'Synced History & A4 PDF Export'}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Yearly Plan */}
                <div
                  onClick={() => setSelectedPlanId('yearly')}
                  className={`relative p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                    selectedPlanId === 'yearly'
                      ? 'border-blue-600 bg-blue-50/40 shadow-md ring-2 ring-blue-600/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="absolute -top-3 right-4 px-3 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-extrabold tracking-wide rounded-full uppercase shadow-xs">
                    {uiLang === 'id' ? 'Hemat 32%' : 'Save 32%'}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900">
                          {uiLang === 'id' ? 'Paket Tahunan' : 'Yearly Plan'}
                        </span>
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedPlanId === 'yearly'
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-300'
                        }`}
                      >
                        {selectedPlanId === 'yearly' && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                      {uiLang === 'id'
                        ? 'Pilihan terbaik untuk dokter, residen & koas'
                        : 'Best value for clinicians, residents & students'}
                    </p>
                    <div className="mb-4">
                      <span className="text-2xl font-extrabold text-slate-900">Rp 399.000</span>
                      <span className="text-xs font-semibold text-slate-500">
                        {uiLang === 'id' ? ' / tahun' : ' / year'}
                      </span>
                      <span className="block text-[11px] text-emerald-600 font-medium mt-0.5">
                        {uiLang === 'id'
                          ? 'Setara ~Rp 33.250 / bulan (Hemat Rp 189rb)'
                          : 'Equivalent to ~Rp 33,250 / month'}
                      </span>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-600">
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Seluruh Fitur Paket Bulanan'
                            : 'Everything in Monthly Plan'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Akses Penuh 1 Tahun (365 Hari)'
                            : 'Full 365-Day Unlimited Access'}
                        </span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {uiLang === 'id'
                            ? 'Prioritas Pemrosesan AI Multimodal'
                            : 'Priority Multimodal AI Processing'}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Payment Methods Info */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-2 font-medium">
                  <CreditCard className="w-4 h-4 text-slate-500" />
                  <span>{uiLang === 'id' ? 'Metode Pembayaran Resmi:' : 'Supported Payments:'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-semibold text-[11px] text-slate-700">
                  {['QRIS', 'GoPay', 'BCA', 'Mandiri', 'BNI', 'BRI', 'Visa/Mastercard'].map((m) => (
                    <span
                      key={m}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded shadow-2xs"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pending Order Resolution Banner */}
              {pendingOrder && !pendingOrder.isSimulated && (
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl space-y-3 shadow-2xs">
                  <div className="flex items-start gap-2.5 text-xs text-blue-950">
                    <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-blue-950">
                          {uiLang === 'id'
                            ? 'Sesi Pembayaran Midtrans Snap Aktif'
                            : 'Active Midtrans Snap Payment Session'}
                        </p>
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-mono text-[10px]">
                          {pendingOrder.orderId}
                        </span>
                      </div>
                      <p className="text-blue-800 text-xs mt-1">
                        {uiLang === 'id'
                          ? 'Setelah menyelesaikan pembayaran, klik tombol hijau "Cek Status Pembayaran" di bawah untuk mengaktifkan Paket Pro secara instan.'
                          : 'Once payment is completed, click "Verify Payment Status" below for instant Pro activation.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {pendingOrder.snapRedirectUrl && (
                      <a
                        href={pendingOrder.snapRedirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>
                          {uiLang === 'id'
                            ? 'Buka Portal Midtrans (Tab Baru)'
                            : 'Open Midtrans Portal (New Tab)'}
                        </span>
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleVerifyPendingOrder(pendingOrder.orderId)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {uiLang === 'id'
                          ? 'Cek Status Pembayaran'
                          : 'Verify Payment Status'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Primary Pay Button */}
              <div className="pt-1">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleSubscribe}
                  className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {uiLang === 'id'
                          ? 'Memproses Sesi Pembayaran Midtrans...'
                          : 'Processing Midtrans Payment Session...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Crown className="w-4 h-4 text-amber-300 fill-amber-300" />
                      <span>
                        {currentUser
                          ? uiLang === 'id'
                            ? `${isAlreadyActive ? 'Perpanjang' : 'Bayar'} ${
                                selectedPlanId === 'monthly' ? 'Rp 49.000' : 'Rp 399.000'
                              } via Midtrans Snap`
                            : `${isAlreadyActive ? 'Extend' : 'Pay'} ${
                                selectedPlanId === 'monthly' ? 'Rp 49,000' : 'Rp 399,000'
                              } via Midtrans Snap`
                          : uiLang === 'id'
                            ? 'Masuk / Daftar untuk Berlangganan'
                            : 'Sign In / Register to Subscribe'}
                      </span>
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 mt-2.5">
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!useSnapPopup}
                      onChange={(e) => setUseSnapPopup(!e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>
                      {uiLang === 'id'
                        ? 'Gunakan mode buka di tab baru (Snap Redirection) alih-alih Popup'
                        : 'Open payment portal in a new browser tab instead of Snap Popup'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Sandbox Guide Accordion */}
              <div className="pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBeginnerGuide((prev) => !prev)}
                  className="w-full flex items-center justify-between py-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
                    <span>
                      {uiLang === 'id'
                        ? 'Panduan Pembayaran & Simulator Midtrans Sandbox'
                        : 'Payment Guide & Midtrans Sandbox Simulator'}
                    </span>
                  </span>
                  {showBeginnerGuide ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {showBeginnerGuide && (
                  <div className="mt-2 p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-600 space-y-2">
                    <p className="leading-relaxed">
                      {uiLang === 'id' ? (
                        <>
                          Pada mode <strong>Midtrans Production</strong>, pembayaran QRIS / Virtual Account / GoPay terverifikasi otomatis melalui Webhook Midtrans. Pada mode <strong>Sandbox</strong>, salin kode QRIS atau Nomor VA lalu simulasikan pelunasan melalui:
                        </>
                      ) : (
                        <>
                          In <strong>Midtrans Production</strong>, QRIS / Virtual Account / E-Wallet payments verify automatically via webhook. In <strong>Sandbox</strong> mode, simulate payment completion using:
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-3 pt-0.5">
                      <a
                        href="https://simulator.sandbox.midtrans.com/bca/va/index"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-semibold inline-flex items-center gap-1"
                      >
                        Simulator BCA VA <ExternalLink className="w-3 h-3" />
                      </a>
                      <a
                        href="https://simulator.sandbox.midtrans.com/qris/index"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-semibold inline-flex items-center gap-1"
                      >
                        Simulator QRIS <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

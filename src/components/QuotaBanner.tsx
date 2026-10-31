import React from 'react';
import { Crown, Sparkles, AlertTriangle, ArrowRight, LogIn } from 'lucide-react';
import type { QuotaInfo } from '../types/auth';
import type { UiLanguage } from '../types/ecg';

interface QuotaBannerProps {
  quotaInfo: QuotaInfo | null;
  onOpenAuth: () => void;
  onOpenSubscribe: () => void;
  uiLang?: UiLanguage;
}

export const QuotaBanner: React.FC<QuotaBannerProps> = ({
  quotaInfo,
  onOpenAuth,
  onOpenSubscribe,
  uiLang = 'id',
}) => {
  if (!quotaInfo) return null;

  const { isSubscribed, remainingQuota, usageCount, maxFreeLimit, isAuthenticated } = quotaInfo;

  if (isSubscribed) {
    return (
      <div className="p-3.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border border-emerald-200/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
            <Crown className="w-4 h-4 fill-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                {uiLang === 'id' ? 'Langganan Pro Aktif' : 'Active Pro Subscription'}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                {uiLang === 'id' ? 'Tanpa Batas Kuota' : 'Unlimited Access'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {uiLang === 'id'
                ? 'Anda memiliki kuota tidak terbatas untuk analisis EKG 12-lead, konteks klinis, riwayat, dan ekspor PDF.'
                : 'You have unlimited access to 12-lead ECG analysis, clinical context correlation, history, and PDF export.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLimitReached = remainingQuota <= 0;

  if (isLimitReached) {
    return (
      <div className="p-4 bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-amber-500/10 border-2 border-amber-300 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-bold text-slate-900">
                {uiLang === 'id'
                  ? `Batas ${maxFreeLimit} Kali Analisis Gratis Tercapai (${usageCount}/${maxFreeLimit})`
                  : `Free ${maxFreeLimit}-Analysis Quota Reached (${usageCount}/${maxFreeLimit})`}
              </h4>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 uppercase tracking-wider">
                {uiLang === 'id' ? 'Kuota Habis' : 'Quota Exhausted'}
              </span>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              {uiLang === 'id'
                ? `Untuk melanjutkan analisis EKG 12-lead tanpa batas dan mengakses fitur laporan klinis lengkap, silakan ${
                    !isAuthenticated ? 'masuk / daftar akun dan berlangganan Paket Pro.' : 'berlangganan Paket Pro.'
                  }`
                : `To continue running unlimited 12-lead ECG interpretations and exporting full clinical reports, please ${
                    !isAuthenticated ? 'sign in / create an account and subscribe to Pro.' : 'subscribe to a Pro plan.'
                  }`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-blue-600" />
                <span>{uiLang === 'id' ? 'Masuk / Daftar' : 'Sign In / Register'}</span>
              </button>
              <button
                type="button"
                onClick={onOpenSubscribe}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/25 cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                <span>{uiLang === 'id' ? 'Berlangganan Pro' : 'Subscribe to Pro'}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenSubscribe}
              className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/25 cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
              <span>{uiLang === 'id' ? 'Aktifkan Paket Pro' : 'Activate Pro Plan'}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3.5 bg-white border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-800">
              {uiLang === 'id'
                ? `Kuota Analisis Gratis Tersisa: ${remainingQuota} dari ${maxFreeLimit} kali`
                : `Free Analysis Quota Remaining: ${remainingQuota} of ${maxFreeLimit}`}
            </span>
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className={`w-4 h-1.5 rounded-full transition-all ${
                    idx < usageCount ? 'bg-slate-200' : 'bg-blue-600'
                  }`}
                />
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {uiLang === 'id'
              ? 'Nikmati 3x uji coba analisis penuh sebelum beralih ke Paket Pro Tanpa Batas.'
              : 'Try 3 full clinical AI ECG analyses for free before upgrading to Unlimited Pro.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenSubscribe}
        className="px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/70 rounded-xl transition-colors flex items-center gap-1.5 shrink-0 self-start sm:self-center cursor-pointer"
      >
        <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
        <span>{uiLang === 'id' ? 'Upgrade Pro Tanpa Batas' : 'Upgrade to Unlimited Pro'}</span>
      </button>
    </div>
  );
};

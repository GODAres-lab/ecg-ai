import React, { useState, useRef, useEffect } from 'react';
import {
  Crown,
  User as UserIcon,
  LogOut,
  ChevronDown,
  Sparkles,
  AlertCircle,
  Calculator,
  History,
  CreditCard,
  Activity,
  Plus,
} from 'lucide-react';
import type { User, QuotaInfo } from '../types/auth';
import type { UiLanguage } from '../types/ecg';

export type ActiveTab = 'analyzer' | 'report' | 'history' | 'disclosure';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  hasReport: boolean;
  historyCount: number;
  onResetAndNewAnalysis: () => void;
  quotaInfo: QuotaInfo | null;
  currentUser: User | null;
  onOpenAuth: () => void;
  onOpenSubscribe: () => void;
  onOpenAccount: () => void;
  onOpenCalculator: () => void;
  onLogout: () => void;
  uiLang: UiLanguage;
  onChangeUiLang: (lang: UiLanguage) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  hasReport,
  historyCount,
  onResetAndNewAnalysis,
  quotaInfo,
  currentUser,
  onOpenAuth,
  onOpenSubscribe,
  onOpenAccount,
  onOpenCalculator,
  onLogout,
  uiLang,
  onChangeUiLang,
}) => {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSubscribed = quotaInfo?.isSubscribed || currentUser?.subscriptionStatus === 'active';
  const remainingQuota = quotaInfo?.remainingQuota ?? 3;

  return (
    <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
      <div className="max-w-7xl mx-auto flex flex-wrap lg:flex-nowrap items-center justify-between gap-y-2 gap-x-4 px-4 sm:px-6 py-2.5">
        {/* Zone 1: Clinical Brand Mark & Quota Pill */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSelectTab('analyzer')}
            className="flex items-center gap-2.5 text-left group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs group-hover:bg-slate-800 transition-colors shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 leading-none">
                AI ECG Analyzer
              </div>
              <div className="text-[10px] font-mono text-slate-500 tracking-wide mt-0.5 hidden sm:block">
                12-LEAD MULTIMODAL CDS
              </div>
            </div>
          </button>

          {/* Quota / Pro Status Badge */}
          {isSubscribed ? (
            <button
              type="button"
              onClick={currentUser ? onOpenAccount : onOpenSubscribe}
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all cursor-pointer"
              title={uiLang === 'id' ? 'Lihat status langganan Pro' : 'View Pro subscription status'}
            >
              <Crown className="w-3 h-3 fill-emerald-600 text-emerald-600" />
              <span>Pro Aktif</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSubscribe}
              className={`hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                remainingQuota <= 0
                  ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
              title={uiLang === 'id' ? 'Klik untuk upgrade ke Pro' : 'Click to upgrade to Pro'}
            >
              {remainingQuota <= 0 ? (
                <AlertCircle className="w-3 h-3 text-amber-600" />
              ) : (
                <Sparkles className="w-3 h-3 text-blue-600" />
              )}
              <span>
                {remainingQuota <= 0
                  ? uiLang === 'id'
                    ? 'Kuota 0/3 (Habis)'
                    : 'Quota 0/3'
                  : uiLang === 'id'
                    ? `Gratis: ${remainingQuota}/3`
                    : `Free: ${remainingQuota}/3`}
              </span>
            </button>
          )}
        </div>

        {/* Zone 2: Primary Navigation Tabs */}
        <nav
          aria-label="Primary Navigation"
          className="order-3 lg:order-2 w-full lg:w-auto flex items-center gap-1 sm:gap-2 text-xs font-semibold text-slate-600 overflow-x-auto border-t lg:border-t-0 border-slate-100 pt-2 lg:pt-0"
        >
          <button
            type="button"
            onClick={() => onSelectTab('analyzer')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'analyzer'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {uiLang === 'id' ? 'Workspace EKG' : 'ECG Workspace'}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('report')}
            disabled={!hasReport}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
              activeTab === 'report'
                ? 'bg-blue-50 text-blue-700 font-bold cursor-pointer'
                : hasReport
                  ? 'hover:bg-slate-100 hover:text-slate-900 cursor-pointer'
                  : 'text-slate-400 cursor-not-allowed'
            }`}
          >
            {hasReport && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            )}
            <span>{uiLang === 'id' ? 'Laporan Interpretasi' : 'Interpretation Report'}</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('history')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'Riwayat' : 'History'}</span>
            {historyCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === 'history'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {historyCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('disclosure')}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'disclosure'
                ? 'bg-blue-50 text-blue-700 font-bold'
                : 'hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {uiLang === 'id' ? 'Kepatuhan Medis' : 'Disclosure & Safety'}
          </button>
        </nav>

        {/* Zone 3: Quick Tools, Language Switcher, Auth & New ECG Action */}
        <div className="order-2 lg:order-3 flex items-center gap-2 shrink-0">
          {/* Clinical QTc Calculator Quick Trigger */}
          <button
            type="button"
            onClick={onOpenCalculator}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
            title={uiLang === 'id' ? 'Kalkulator Klinis QTc & Kertas EKG' : 'Clinical QTc & Grid Calculator'}
          >
            <Calculator className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden xl:inline">{uiLang === 'id' ? 'Kalkulator QTc' : 'QTc Calc'}</span>
          </button>

          {/* Bilingual Toggle (ID / EN) */}
          <div
            role="group"
            aria-label="Language Switcher"
            className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-[11px] font-bold"
          >
            <button
              type="button"
              onClick={() => onChangeUiLang('id')}
              className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                uiLang === 'id' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ID
            </button>
            <button
              type="button"
              onClick={() => onChangeUiLang('en')}
              className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                uiLang === 'en' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              EN
            </button>
          </div>

          {!isSubscribed && (
            <button
              type="button"
              onClick={onOpenSubscribe}
              className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
            >
              <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span>Pro</span>
            </button>
          )}

          {currentUser ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 p-1.5 sm:px-2.5 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">
                  {(currentUser.username || currentUser.name).charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline-block max-w-[110px] truncate">
                  {currentUser.name || currentUser.username}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {/* User Account Dropdown Menu */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-2 z-50 animate-in fade-in duration-150">
                  <div className="px-3 py-2.5 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {currentUser.name || currentUser.username}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{currentUser.email}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      {isSubscribed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <Crown className="w-3 h-3 fill-emerald-600 text-emerald-600" />
                          <span>{uiLang === 'id' ? 'Langganan Pro Aktif' : 'Active Pro Plan'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                          {uiLang === 'id'
                            ? `Akun Gratis (${currentUser.freeUsageCount}/3 Terpakai)`
                            : `Free Tier (${currentUser.freeUsageCount}/3 Used)`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="py-1 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAccount();
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                      <span>
                        {uiLang === 'id'
                          ? 'Profil & Riwayat Pembayaran'
                          : 'Profile & Payment History'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onSelectTab('history');
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <History className="w-3.5 h-3.5 text-slate-500" />
                        <span>{uiLang === 'id' ? 'Riwayat Analisis EKG' : 'ECG Analysis History'}</span>
                      </span>
                      {historyCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-mono">
                          {historyCount}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenSubscribe();
                      }}
                      className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                        isSubscribed
                          ? 'text-emerald-700 hover:bg-emerald-50'
                          : 'text-blue-600 hover:bg-blue-50'
                      }`}
                    >
                      <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span>
                        {isSubscribed
                          ? uiLang === 'id'
                            ? 'Perpanjang Paket Pro'
                            : 'Extend Pro Subscription'
                          : uiLang === 'id'
                            ? 'Upgrade ke Paket Pro'
                            : 'Upgrade to Pro Plan'}
                      </span>
                    </button>

                    <div className="my-1 border-t border-slate-100" />

                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{uiLang === 'id' ? 'Keluar dari Akun' : 'Sign Out'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <UserIcon className="w-3.5 h-3.5 text-slate-600" />
              <span>{uiLang === 'id' ? 'Masuk' : 'Sign In'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onResetAndNewAnalysis}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{uiLang === 'id' ? 'EKG Baru' : 'New ECG'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

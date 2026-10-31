/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type {
  AnalysisHistoryItem,
  ClinicalContextInput,
  ConsentRecord,
  EcgAnalysisReport,
  UiLanguage,
} from './types/ecg';
import type { User, QuotaInfo } from './types/auth';
import {
  generateClinicalSampleEcgFile,
  processEcgImageFile,
  type ProcessedEcgImage,
  type SampleEcgScenario,
} from './utils/imageProcessor';
import { validateAndNormalizeEcgResponse } from './utils/ecgValidation';
import { apiFetch, removeAuthToken, getAuthToken } from './utils/authStorage';
import {
  DISCLAIMER_TRANSLATION,
  getSavedUiLanguage,
  saveUiLanguage,
} from './utils/i18n';
import {
  clearAllLocalHistory,
  createCompactThumbnail,
  loadLocalHistory,
  prependLocalHistoryItem,
  removeLocalHistoryItem,
  syncHistoryWithServer,
} from './utils/historyStorage';
import { Header, type ActiveTab } from './components/Header';
import { DisclosureModal } from './components/DisclosureModal';
import { DisclosureTabView } from './components/DisclosureTabView';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { CaptureUploadPanel } from './components/CaptureUploadPanel';
import { EcgReportView } from './components/EcgReportView';
import { HistoryTabView } from './components/HistoryTabView';
import { AuthModal } from './components/AuthModal';
import { SubscriptionModal } from './components/SubscriptionModal';
import { AccountModal } from './components/AccountModal';
import { ClinicalCalculatorModal } from './components/ClinicalCalculatorModal';
import { ToastContainer, type ToastMessage } from './components/ToastContainer';
import { CheckCircle2, AlertCircle, X, Activity } from 'lucide-react';

const CONSENT_STORAGE_KEY = 'ai_ecg_analyzer_educational_consent_v1';

export default function App() {
  const [uiLang, setUiLang] = useState<UiLanguage>(() => getSavedUiLanguage());
  const [reportLanguage, setReportLanguage] = useState<UiLanguage>(() => getSavedUiLanguage());

  const [consentRecord, setConsentRecord] = useState<ConsentRecord | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        return {
          acknowledged: true,
          timestamp: new Date().toISOString(),
          educationalPurposeAccepted: true,
          nonDiagnosticAccepted: true,
          clinicianReviewAccepted: true,
        };
      }
      const saved = sessionStorage.getItem(CONSENT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ConsentRecord;
        if (parsed && parsed.acknowledged) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage access errors
    }
    return null;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');
  const [selectedImage, setSelectedImage] = useState<ProcessedEcgImage | null>(null);
  const [autoAnalyzeOnSelect, setAutoAnalyzeOnSelect] = useState<boolean>(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStageText, setAnalysisStageText] = useState<string>(
    'Preparing unmodified ECG image...'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clinical Context & Active Report state
  const [clinicalContext, setClinicalContext] = useState<ClinicalContextInput>({
    patientAgeSex: '',
    symptoms: '',
    clinicalHistory: '',
  });
  const [report, setReport] = useState<EcgAnalysisReport | null>(null);
  const [activeReportContext, setActiveReportContext] = useState<
    ClinicalContextInput | undefined
  >(undefined);
  const [activeHistoryThumbnail, setActiveHistoryThumbnail] = useState<string | undefined>(
    undefined
  );
  const [modelUsed, setModelUsed] = useState<string>('AI Multimodal Vision');
  const [analyzedAt, setAnalyzedAt] = useState<string>('');

  // History & Modals
  const [historyItems, setHistoryItems] = useState<AnalysisHistoryItem[]>(() =>
    loadLocalHistory()
  );
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [isCalculatorModalOpen, setIsCalculatorModalOpen] = useState<boolean>(false);

  // Authentication & Subscription states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<QuotaInfo | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState<boolean>(false);
  const [paymentNotification, setPaymentNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Toast Notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const pushToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleChangeUiLang = useCallback((lang: UiLanguage) => {
    setUiLang(lang);
    setReportLanguage(lang);
    saveUiLanguage(lang);
  }, []);

  // Refresh quota and user status from server
  const refreshQuota = useCallback(async () => {
    try {
      const res = await apiFetch('/api/user/quota');
      if (res.ok) {
        const data = await res.json();
        setQuotaInfo(data);
        if (data.isAuthenticated && data.user) {
          setCurrentUser(data.user);
        } else if (!data.isAuthenticated) {
          setCurrentUser(null);
        }
      }
    } catch (err) {
      console.warn('Failed to refresh user quota:', err);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const synced = await syncHistoryWithServer();
    setHistoryItems(synced);
  }, []);

  useEffect(() => {
    refreshQuota();
    refreshHistory();

    // Check if returning from Midtrans Snap redirect callback
    const searchParams = new URLSearchParams(window.location.search);
    const orderId = searchParams.get('order_id');
    const transactionStatus = searchParams.get('transaction_status');
    const payment = searchParams.get('payment');

    if (orderId) {
      if (
        transactionStatus === 'settlement' ||
        transactionStatus === 'capture' ||
        payment === 'success'
      ) {
        apiFetch(`/api/subscription/verify-order/${orderId}`, {
          method: 'POST',
        })
          .then((res) => res.json())
          .then((data) => {
            if (data?.success && data?.user) {
              setCurrentUser(data.user);
              refreshQuota();
              setPaymentNotification({
                type: 'success',
                message: `Selamat! Pembayaran langganan Pro (${orderId}) berhasil diverifikasi. Akun Anda kini aktif tanpa batas kuota.`,
              });
            } else {
              setPaymentNotification({
                type: 'info',
                message: `Status pembayaran pesanan ${orderId}: ${data?.message || 'Sedang diproses di Midtrans.'}`,
              });
            }
          })
          .catch((err) => {
            console.warn('Order callback verification failed:', err);
            setPaymentNotification({
              type: 'error',
              message: `Gagal memverifikasi status pesanan ${orderId}. Silakan cek menu Akun & Transaksi Anda.`,
            });
          })
          .finally(() => {
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
          });
      } else if (payment === 'cancelled' || payment === 'error') {
        setPaymentNotification({
          type: 'error',
          message: 'Sesi pembayaran Midtrans dibatalkan atau belum selesai.',
        });
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    }
  }, [refreshQuota, refreshHistory]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleLogout = () => {
    removeAuthToken();
    setCurrentUser(null);
    setIsAccountModalOpen(false);
    refreshQuota();
    pushToast(
      'info',
      uiLang === 'id' ? 'Anda telah keluar dari akun.' : 'You have signed out.'
    );
  };

  const handleAcceptConsent = (record: ConsentRecord) => {
    setConsentRecord(record);
    try {
      sessionStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Ignore sessionStorage errors
    }
  };

  const handleRevokeConsent = () => {
    setConsentRecord(null);
    try {
      sessionStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // Ignore sessionStorage errors
    }
  };

  const executeAnalysis = async (imageToAnalyze: ProcessedEcgImage) => {
    // Client-side quota guard
    if (quotaInfo && !quotaInfo.isSubscribed && quotaInfo.remainingQuota <= 0) {
      if (!currentUser) {
        setAuthModalReason(
          uiLang === 'id'
            ? 'Batas 3 kali analisis gratis telah tercapai. Silakan masuk atau daftarkan akun baru dan berlangganan untuk melanjutkan.'
            : 'Your 3 free ECG analyses have been used. Please sign in or create an account and subscribe to continue.'
        );
        setIsAuthModalOpen(true);
      } else {
        setIsSubscriptionModalOpen(true);
      }
      setErrorMessage(
        uiLang === 'id'
          ? 'Batas 3 kali analisis gratis telah tercapai. Silakan berlangganan Pro untuk akses tanpa batas.'
          : 'Free 3-analysis quota reached. Please upgrade to Pro Unlimited to continue.'
      );
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    setErrorMessage(null);
    setAnalysisStageText(
      uiLang === 'id'
        ? `Mengirim rekaman EKG ${imageToAnalyze.width}×${imageToAnalyze.height} px (${imageToAnalyze.orientationDescription}) ke mesin AI...`
        : `Transmitting ${imageToAnalyze.width}×${imageToAnalyze.height} px ECG (${imageToAnalyze.orientationDescription}) to AI API...`
    );

    const stageTimer = setTimeout(() => {
      setAnalysisStageText(
        uiLang === 'id'
          ? 'Mengevaluasi gelombang 12 sadapan, interval PR/QRS/QTc, aksis listrik, serta perbandingan teks mesin EKG...'
          : 'Evaluating 12-lead waveforms, intervals, electrical axis, and printed machine interpretation...'
      );
    }, 2400);

    const trimmedContext: ClinicalContextInput = {
      patientAgeSex: clinicalContext.patientAgeSex?.trim() || undefined,
      symptoms: clinicalContext.symptoms?.trim() || undefined,
      clinicalHistory: clinicalContext.clinicalHistory?.trim() || undefined,
    };
    const hasContext = Boolean(
      trimmedContext.patientAgeSex ||
        trimmedContext.symptoms ||
        trimmedContext.clinicalHistory
    );

    try {
      const response = await apiFetch('/api/analyze-ecg', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: imageToAnalyze.base64Data,
          mimeType: imageToAnalyze.mimeType,
          fileName: imageToAnalyze.file.name,
          orientationNote: `${imageToAnalyze.orientationDescription} (${imageToAnalyze.width}x${imageToAnalyze.height}px)`,
          reportLanguage,
          clinicalContext: hasContext ? trimmedContext : undefined,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (response.status === 403) {
        if (payload?.code === 'QUOTA_EXCEEDED') {
          setAuthModalReason(
            payload?.error ||
              'Batas 3 kali analisis gratis untuk pengguna baru telah tercapai. Silakan masuk atau daftar dan berlangganan.'
          );
          setIsAuthModalOpen(true);
        } else if (payload?.code === 'SUBSCRIPTION_REQUIRED') {
          setIsSubscriptionModalOpen(true);
        }
        await refreshQuota();
        throw new Error(payload?.error || 'Batas penggunaan gratis tercapai.');
      }

      if (!response.ok) {
        const serverErr =
          payload && typeof payload.error === 'string'
            ? payload.error
            : `Server returned status ${response.status}.`;
        throw new Error(serverErr);
      }

      if (!payload || !payload.report) {
        throw new Error('Incomplete response received from the ECG analysis endpoint.');
      }

      const validatedReport = validateAndNormalizeEcgResponse(payload.report);
      const cleanModelName = payload.modelUsed
        ? String(payload.modelUsed).replace(/gemini/gi, 'AI')
        : 'AI Multimodal Vision';
      const timestamp = payload.analyzedAt || new Date().toISOString();

      const thumbnailDataUrl = await createCompactThumbnail(imageToAnalyze.previewDataUrl);

      setReport(validatedReport);
      setActiveReportContext(hasContext ? trimmedContext : undefined);
      setActiveHistoryThumbnail(thumbnailDataUrl);
      setModelUsed(cleanModelName);
      setAnalyzedAt(timestamp);

      // Save to local & synced history
      const historyEntry: AnalysisHistoryItem = {
        id: payload.analysisId || `ecg_${Date.now()}`,
        analyzedAt: timestamp,
        fileName: imageToAnalyze.file.name || 'ECG Recording',
        modelUsed: cleanModelName,
        reportLanguage,
        clinicalContext: hasContext ? trimmedContext : undefined,
        thumbnailDataUrl,
        report: validatedReport,
      };
      const updatedHistory = prependLocalHistoryItem(historyEntry);
      setHistoryItems(updatedHistory);

      // Update quota state immediately
      if (payload.quota) {
        setQuotaInfo((prev) => (prev ? { ...prev, ...payload.quota } : payload.quota));
      }
      refreshQuota();

      setActiveTab('report');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      pushToast(
        'success',
        uiLang === 'id'
          ? 'Analisis EKG 12-lead selesai dan tersimpan di Riwayat.'
          : '12-lead ECG analysis completed and saved to History.'
      );
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMessage(
          uiLang === 'id'
            ? 'Permintaan analisis EKG dibatalkan oleh pengguna.'
            : 'ECG analysis request was cancelled by user.'
        );
      } else {
        const message =
          err instanceof Error
            ? err.message
            : uiLang === 'id'
              ? 'Gagal menganalisis gambar EKG. Periksa koneksi Anda lalu coba kembali.'
              : 'Failed to analyze the ECG image. Please check your connection and try again.';
        setErrorMessage(message);
      }
    } finally {
      clearTimeout(stageTimer);
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleFileSelected = async (file: File) => {
    setErrorMessage(null);
    try {
      const processed = await processEcgImageFile(file);
      setSelectedImage(processed);
      if (autoAnalyzeOnSelect) {
        await executeAnalysis(processed);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to process the selected ECG file.';
      setErrorMessage(message);
    }
  };

  const handleLoadSampleEcg = async (scenario: SampleEcgScenario) => {
    setErrorMessage(null);
    try {
      const sampleFile = await generateClinicalSampleEcgFile(scenario);
      const processed = await processEcgImageFile(sampleFile);
      setSelectedImage(processed);
      await executeAnalysis(processed);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to generate or analyze sample ECG strip.';
      setErrorMessage(message);
    }
  };

  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleResetAndNewAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setReport(null);
    setSelectedImage(null);
    setActiveHistoryThumbnail(undefined);
    setActiveReportContext(undefined);
    setErrorMessage(null);
    setActiveTab('analyzer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectHistoryItem = (item: AnalysisHistoryItem) => {
    setReport(item.report);
    setSelectedImage(null);
    setActiveHistoryThumbnail(item.thumbnailDataUrl);
    setActiveReportContext(item.clinicalContext);
    setModelUsed(item.modelUsed || 'AI Multimodal Vision');
    setAnalyzedAt(item.analyzedAt);
    setActiveTab('report');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteHistoryItem = (id: string) => {
    const next = removeLocalHistoryItem(id);
    setHistoryItems(next);
    if (getAuthToken()) {
      apiFetch(`/api/user/history/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    pushToast(
      'info',
      uiLang === 'id'
        ? 'Item riwayat analisis telah dihapus.'
        : 'Analysis history item removed.'
    );
  };

  const handleClearAllHistory = () => {
    clearAllLocalHistory();
    setHistoryItems([]);
    if (getAuthToken()) {
      apiFetch('/api/user/history', {
        method: 'DELETE',
      }).catch(() => {});
    }
    pushToast(
      'info',
      uiLang === 'id'
        ? 'Seluruh riwayat analisis telah dikosongkan.'
        : 'All analysis history has been cleared.'
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
      {/* Opening Educational Disclosure & Consent Gate */}
      {!consentRecord?.acknowledged && (
        <DisclosureModal
          onAcceptConsent={handleAcceptConsent}
          uiLang={uiLang}
          onChangeUiLang={handleChangeUiLang}
        />
      )}

      {/* Top Navigation Bar with Quota, History, QTc Tools, Language, and User Auth */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        hasReport={Boolean(report)}
        historyCount={historyItems.length}
        onResetAndNewAnalysis={handleResetAndNewAnalysis}
        quotaInfo={quotaInfo}
        currentUser={currentUser}
        onOpenAuth={() => {
          setAuthModalReason(null);
          setIsAuthModalOpen(true);
        }}
        onOpenSubscribe={() => setIsSubscriptionModalOpen(true)}
        onOpenAccount={() => setIsAccountModalOpen(true)}
        onOpenCalculator={() => setIsCalculatorModalOpen(true)}
        onLogout={handleLogout}
        uiLang={uiLang}
        onChangeUiLang={handleChangeUiLang}
      />

      {/* Midtrans Payment Return Notification Banner */}
      {paymentNotification && (
        <div
          className={`no-print py-3 px-4 text-xs font-semibold shadow-xs transition-all ${
            paymentNotification.type === 'success'
              ? 'bg-emerald-600 text-white'
              : paymentNotification.type === 'error'
                ? 'bg-rose-600 text-white'
                : 'bg-blue-600 text-white'
          }`}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {paymentNotification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-white/90" />
              )}
              <span>{paymentNotification.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setPaymentNotification(null)}
              className="p-1 hover:bg-black/20 rounded-md transition-colors cursor-pointer"
              aria-label="Tutup pemberitahuan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {activeTab === 'analyzer' && (
          <CaptureUploadPanel
            selectedImage={selectedImage}
            isAnalyzing={isAnalyzing}
            analysisStageText={analysisStageText}
            autoAnalyzeOnSelect={autoAnalyzeOnSelect}
            onToggleAutoAnalyze={setAutoAnalyzeOnSelect}
            errorMessage={errorMessage}
            onFileSelected={handleFileSelected}
            onOpenCameraModal={() => setIsCameraModalOpen(true)}
            onTriggerAnalyze={() => {
              if (!selectedImage) {
                setErrorMessage(
                  uiLang === 'id'
                    ? 'Belum ada gambar EKG yang dipilih. Ambil foto atau unggah berkas EKG terlebih dahulu.'
                    : 'No ECG image is loaded. Please take a photo or upload an ECG image first.'
                );
                return;
              }
              executeAnalysis(selectedImage);
            }}
            onCancelAnalysis={handleCancelAnalysis}
            onClearImage={() => {
              setSelectedImage(null);
              setErrorMessage(null);
            }}
            onLoadSampleEcg={handleLoadSampleEcg}
            onOpenDisclosureTab={() => setActiveTab('disclosure')}
            onOpenCalculator={() => setIsCalculatorModalOpen(true)}
            quotaInfo={quotaInfo}
            onOpenAuth={() => {
              setAuthModalReason(null);
              setIsAuthModalOpen(true);
            }}
            onOpenSubscribe={() => setIsSubscriptionModalOpen(true)}
            clinicalContext={clinicalContext}
            onChangeClinicalContext={setClinicalContext}
            reportLanguage={reportLanguage}
            onChangeReportLanguage={setReportLanguage}
            uiLang={uiLang}
            onPasteSuccess={() =>
              pushToast(
                'info',
                uiLang === 'id'
                  ? 'Gambar EKG berhasil ditempel dari clipboard.'
                  : 'ECG image pasted from clipboard.'
              )
            }
          />
        )}

        {activeTab === 'report' && report && (
          <EcgReportView
            report={report}
            image={selectedImage}
            fallbackImageUrl={activeHistoryThumbnail}
            clinicalContext={activeReportContext}
            modelUsed={modelUsed}
            analyzedAt={analyzedAt}
            onAnalyzeAnother={handleResetAndNewAnalysis}
            onOpenCalculator={() => setIsCalculatorModalOpen(true)}
            onNotify={pushToast}
            uiLang={uiLang}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTabView
            historyItems={historyItems}
            onSelectHistoryItem={handleSelectHistoryItem}
            onDeleteHistoryItem={handleDeleteHistoryItem}
            onClearAllHistory={handleClearAllHistory}
            onStartNewAnalysis={handleResetAndNewAnalysis}
            uiLang={uiLang}
          />
        )}

        {activeTab === 'disclosure' && (
          <DisclosureTabView
            consentRecord={consentRecord}
            onRevokeConsent={handleRevokeConsent}
            onProceedToAnalyzer={() => setActiveTab('analyzer')}
            uiLang={uiLang}
          />
        )}
      </main>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          refreshQuota();
          refreshHistory();
          pushToast(
            'success',
            uiLang === 'id'
              ? `Selamat datang, ${user.name}!`
              : `Welcome, ${user.name}!`
          );
          if (user.subscriptionStatus !== 'active' && user.freeUsageCount >= 3) {
            setIsSubscriptionModalOpen(true);
          }
        }}
        reasonMessage={authModalReason}
      />

      {/* Midtrans Subscription Modal */}
      <SubscriptionModal
        isOpen={isSubscriptionModalOpen}
        onClose={() => setIsSubscriptionModalOpen(false)}
        currentUser={currentUser}
        onOpenAuth={() => {
          setAuthModalReason(
            uiLang === 'id'
              ? 'Silakan masuk atau buat akun baru terlebih dahulu untuk melanjutkan pembayaran.'
              : 'Please sign in or create an account first to proceed with payment.'
          );
          setIsAuthModalOpen(true);
        }}
        onSubscriptionActivated={(updatedUser) => {
          setCurrentUser(updatedUser);
          refreshQuota();
          pushToast(
            'success',
            uiLang === 'id'
              ? 'Langganan Pro Unlimited Anda telah aktif!'
              : 'Your Pro Unlimited subscription is now active!'
          );
        }}
        uiLang={uiLang}
      />

      {/* User Account, Password & Transaction History Modal */}
      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        currentUser={currentUser}
        quotaInfo={quotaInfo}
        onUserUpdated={(updatedUser) => {
          setCurrentUser(updatedUser);
          refreshQuota();
        }}
        onOpenSubscribe={() => {
          setIsAccountModalOpen(false);
          setIsSubscriptionModalOpen(true);
        }}
        uiLang={uiLang}
      />

      {/* Interactive Clinical QTc & ECG Paper Box Calculator Modal */}
      <ClinicalCalculatorModal
        isOpen={isCalculatorModalOpen}
        onClose={() => setIsCalculatorModalOpen(false)}
        initialHrBpm={report?.heart_rate.ventricular_rate_bpm.value}
        initialQtMs={report?.intervals.qt_interval_ms.value}
        uiLang={uiLang}
      />

      {/* Camera Capture Modal */}
      {isCameraModalOpen && (
        <CameraCaptureModal
          onCaptureFile={(file) => {
            setIsCameraModalOpen(false);
            handleFileSelected(file);
          }}
          onClose={() => setIsCameraModalOpen(false)}
          onFallbackFilePick={() => {
            const input = document.querySelector<HTMLInputElement>(
              'input[aria-label="Capture Photo with Device Camera"]'
            );
            input?.click();
          }}
          uiLang={uiLang}
        />
      )}

      {/* Floating Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Quiet Clinical Footer */}
      <footer className="no-print border-t border-slate-200 bg-white px-4 sm:px-6 py-5 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 text-xs text-slate-500">
          <div className="space-y-1.5 max-w-4xl">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <Activity className="w-3.5 h-3.5 text-blue-600" />
              <span>AI ECG Analyzer · Clinical Decision Support & Medical Education</span>
            </div>
            <p className="leading-relaxed">{DISCLAIMER_TRANSLATION[uiLang]}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 shrink-0 font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => setIsCalculatorModalOpen(true)}
              className="hover:text-blue-600 transition-colors cursor-pointer"
            >
              {uiLang === 'id' ? 'Kalkulator QTc' : 'QTc Calculator'}
            </button>
            <span className="text-slate-300" aria-hidden="true">
              •
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className="hover:text-blue-600 transition-colors cursor-pointer"
            >
              {uiLang === 'id' ? 'Riwayat Analisis' : 'Analysis History'}
            </button>
            <span className="text-slate-300" aria-hidden="true">
              •
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('disclosure')}
              className="hover:text-blue-600 underline transition-colors cursor-pointer"
            >
              {uiLang === 'id' ? 'Kepatuhan & Persetujuan' : 'Disclosure & Consent'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, AlertCircle, Upload } from 'lucide-react';
import type { UiLanguage } from '../types/ecg';

interface CameraCaptureModalProps {
  onCaptureFile: (file: File) => void;
  onClose: () => void;
  onFallbackFilePick: () => void;
  uiLang?: UiLanguage;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  onCaptureFile,
  onClose,
  onFallbackFilePick,
  uiLang = 'id',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          uiLang === 'id'
            ? 'Akses kamera langsung tidak tersedia pada konteks peramban ini. Silakan gunakan tombol pilih/ambil foto perangkat di bawah.'
            : 'Camera access API is unavailable in this browser context. Please use native device camera upload below.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (active) setIsReady(true);
          };
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('denied') ||
          msg.toLowerCase().includes('notallowed')
        ) {
          setCameraError(
            uiLang === 'id'
              ? 'Izin akses kamera ditolak. Mohon izinkan kamera di pengaturan peramban Anda atau unggah foto EKG langsung.'
              : 'Camera permission was denied. Please grant camera access in your browser settings or use Upload ECG Image.'
          );
        } else {
          setCameraError(
            uiLang === 'id'
              ? `Tidak dapat membuka kamera langsung (${msg}). Anda dapat mengambil foto menggunakan pemilih file kamera perangkat di bawah.`
              : `Unable to access live camera stream (${msg}). You can capture directly from your device camera below.`
          );
        }
      }
    }

    startCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [uiLang]);

  const handleCaptureSnapshot = () => {
    const video = videoRef.current;
    if (!video || !isReady) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1600;
    canvas.height = video.videoHeight || 1200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const capturedFile = new File([blob], `ecg_camera_${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        onCaptureFile(capturedFile);
      },
      'image/jpeg',
      0.95
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <Camera className="w-4 h-4 text-sky-400" />
            <h2 id="camera-modal-title" className="text-sm font-bold">
              {uiLang === 'id' ? 'Ambil Foto Kertas Rekaman EKG' : 'Capture Printed ECG Report'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Camera Modal"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {uiLang === 'id'
              ? 'Arahkan kamera ke kertas rekaman EKG dengan pencahayaan merata. Orientasi (potret, lanskap, atau terbalik) ditangani otomatis oleh AI tanpa perlu pemotongan manual.'
              : 'Point your camera at the printed ECG report under even lighting. Orientation and perspective are handled automatically during AI analysis.'}
          </p>

          {cameraError ? (
            <div className="p-5 bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
              <div className="flex items-start gap-2.5 text-rose-900">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold">
                    {uiLang === 'id' ? 'Kamera Langsung Tidak Tersedia' : 'Camera Stream Unavailable'}
                  </p>
                  <p>{cameraError}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onFallbackFilePick();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {uiLang === 'id'
                      ? 'Ambil Foto / Pilih dari Perangkat'
                      : 'Capture via Device File Picker'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 cursor-pointer"
                >
                  {uiLang === 'id' ? 'Tutup' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative bg-slate-950 rounded-2xl overflow-hidden aspect-video flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
                {/* Subtle Framing Guide */}
                <div className="pointer-events-none absolute inset-5 border border-dashed border-sky-400/40 rounded-xl" />
                {!isReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-slate-300">
                    {uiLang === 'id' ? 'Menyiapkan kamera...' : 'Initializing camera stream...'}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-mono text-slate-500">
                  Zero-Preprocessing • Auto-Orientation
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    {uiLang === 'id' ? 'Batal' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    disabled={!isReady}
                    onClick={handleCaptureSnapshot}
                    className={`inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl transition-colors ${
                      isReady
                        ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                        : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Camera className="w-4 h-4" />
                    <span>{uiLang === 'id' ? 'Jepret & Analisis EKG' : 'Capture & Analyze ECG'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

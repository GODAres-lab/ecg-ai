import type { SubscriptionPlan } from '../src/types/subscription.ts';

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'Paket Pro Bulanan',
    tagline: 'Ideal untuk evaluasi klinis, jaga IGD, dan pembelajaran rutin',
    price: 49000,
    formattedPrice: 'Rp 49.000',
    period: '/ bulan',
    durationDays: 30,
    features: [
      'Akses Analisis EKG 12-Lead Tanpa Batas Kuota',
      'AI Multimodal Vision Presisi Klinis (14 Seksi Lengkap)',
      'Kompas Aksis Hexaxial Visual & Kalkulator QTc Multi-Rumus',
      'Korelasi Konteks Klinis & Bahasa Laporan (ID / EN)',
      'Ekspor & Cetak PDF Laporan Medis Standar A4',
      'Penyimpanan & Sinkronisasi Riwayat Analisis',
    ],
  },
  {
    id: 'yearly',
    name: 'Paket Pro Tahunan',
    tagline: 'Pilihan paling hemat untuk dokter, residen, perawat & koas',
    price: 399000,
    formattedPrice: 'Rp 399.000',
    period: '/ tahun',
    durationDays: 365,
    popular: true,
    savingsBadge: 'Hemat 32%',
    features: [
      'Seluruh fitur lengkap pada Paket Pro Bulanan',
      'Akses Penuh Tanpa Batas selama 1 Tahun (365 Hari)',
      'Hemat Rp 189.000 dibanding berlangganan bulanan',
      'Prioritas Pemrosesan AI Multimodal Berkecepatan Tinggi',
      'Pembaruan Fitur Klinis & Model AI Terbaru Otomatis',
      'Dukungan Teknis Prioritas 24/7',
    ],
  },
];

export function getPlanById(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

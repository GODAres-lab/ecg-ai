# AI ECG Analyzer — 12-Lead Multimodal ECG Interpretation Platform

Aplikasi web interpretasi rekaman **EKG 12-Lead berbasis AI Multimodal** yang dirancang untuk dukungan keputusan klinis (*Clinical Decision Support*) dan edukasi medis, dibangun menggunakan **React 19, TypeScript, Tailwind CSS v4, Express, Midtrans Snap, dan Google GenAI SDK (`@google/genai`)**.

---

## Pernyataan Keselamatan Medis & Tujuan Edukasi

> **"Interpretasi EKG berbasis AI ini ditujukan khusus untuk dukungan keputusan klinis dan edukasi medis. Hasil dapat mengandung kekeliruan dan wajib ditinjau oleh dokter atau tenaga medis yang berwenang. Jangan digunakan sebagai satu-satunya dasar diagnosis atau terapi. Jika dicurigai kondisi jantung darurat, segera cari pertolongan medis gawat darurat."**

Saat pertama kali membuka aplikasi, pengguna wajib menyetujui **Persetujuan Edukasi & Keselamatan Klinis** sebelum dapat mengakses ruang kerja analisis.

---

## Fitur Utama

- **Zero-Preprocessing 12-Lead Vision**: Unggah berkas (`JPEG`, `PNG`, `WebP`), ambil foto kamera langsung, atau tempel tangkapan layar via `Ctrl+V` (Clipboard Paste). Mendeteksi orientasi EXIF otomatis + rotasi manual ±90°.
- **Konteks Klinis Opsional & Dwibahasa (`ID` / `EN`)**: Sertakan usia/jenis kelamin, keluhan utama (nyeri dada, sesak, palpitasi, sinkop), serta riwayat klinis untuk mempertajam korelasi diferensial AI dalam Bahasa Indonesia maupun Bahasa Inggris.
- **14 Bagian Laporan EKG Terstruktur**:
  1. Informasi Rekaman & Kecepatan Kertas
  2. Evaluasi Kualitas Gambar & Artefak
  3. Klasifikasi Urgensi Klinis
  4. Laju Jantung, Irama & Interval (`PR`, `QRS`, `QT`, `QTc`)
  5. Aksis Listrik Jantung + **Diagram Kompas Hexaxial Cabrera SVG Interaktif (`-180°` s/d `+180°`)**
  6. Analisis Sadapan per Teritori Anatomis (`Inferior`, `Lateral`, `Anterior/Septal`)
  7. Morfologi Gelombang (`P`, `QRS`, `ST-Segment`, `T`, `U`)
  8. Evaluasi Iskemia / Infark Miokard / STEMI Equivalents
  9. Aritmia & Gangguan Konduksi
  10. Temuan Tambahan & Catatan Elektrolit
  11. Perbandingan Objektif dengan Teks Cetakan Mesin EKG
  12. Kesimpulan Klinis Terintegrasi & Diagnosis Banding
  13. Rekomendasi Tindak Lanjut & Keterbatasan
  14. Tingkat Kepercayaan AI (*Confidence Rationale*)
- **Inspektor Rekaman EKG Fullscreen (Lightbox)**: Zoom `50%–400%` (scroll roda mouse & drag-to-pan), rotasi 90°, penguat kontras kertas termal, dan inversi warna.
- **Kalkulator Klinis QTc & Kertas EKG**: Perhitungan `QTc` multi-formula (*Bazett, Fridericia, Framingham, Hodges*) beserta konverter kotak milimeter kertas EKG (`25 mm/s` & `50 mm/s`).
- **Riwayat Analisis Tersinkronisasi & Privasi Ephemeral**: Gambar mentah pasien diproses secara *ephemeral* di memori server (tidak pernah disimpan di disk server). Metadata laporan terstruktur tersimpan di riwayat akun & peramban lokal, lengkap dengan ekspor **PDF Klinis**, **Salin Teks**, **Unduh `.txt`**, dan **Cetak**.
- **Autentikasi Akun, Kuota & Langganan Midtrans**: Kuota uji coba gratis 3 analisis, manajemen profil & kata sandi, riwayat transaksi Midtrans, serta aktivasi paket Pro Unlimited (Bulanan / Tahunan) dengan QRIS, Virtual Account, E-Wallet, dan Kartu Kredit.

---

## Instalasi & Pengembangan Lokal

1. **Instal dependensi**:
   ```bash
   npm install
   ```
2. **Konfigurasi environment variable**:
   ```bash
   cp .env.example .env
   ```
   Isi `GEMINI_API_KEY`, `JWT_SECRET`, serta kunci Sandbox/Production `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` pada berkas `.env`.
3. **Jalankan pengujian unit & tipe TypeScript**:
   ```bash
   npm test
   npm run lint
   ```
4. **Jalankan server pengembangan** (`http://localhost:3000`):
   ```bash
   npm run dev
   ```

---

## Push ke GitHub & Deployment ke VPS Linux

Panduan lengkap konfigurasi **Nginx Reverse Proxy**, **Systemd Service**, **UFW Firewall**, **Let's Encrypt SSL/HTTPS (Certbot)**, dan **Docker Compose** tersedia di [`deploy/README.md`](./deploy/README.md).

Ringkasan cepat untuk VPS Ubuntu/Debian:
```bash
git clone <URL_GITHUB_REPO_ANDA> /var/www/ecg-ai
cd /var/www/ecg-ai
cp .env.production.example .env
nano .env
chmod +x deploy/scripts/deploy-linux.sh
./deploy/scripts/deploy-linux.sh ecg.domainanda.com
sudo certbot --nginx -d ecg.domainanda.com --redirect
```

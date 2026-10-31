# Panduan Deployment VPS & Operasional AI ECG Analyzer

Dokumen ini menjelaskan langkah demi langkah cara mengunggah (*push*) kode ke **GitHub** dan men-deploy **AI ECG Analyzer** ke **VPS Linux (Ubuntu 22.04/24.04 atau Debian 12)** maupun menggunakan **Docker Compose**.

---

## 1. Arsitektur Produksi & Keamanan

```
[ Browser Klien ] (Desktop, Tablet, Smartphone)
        │
        │ HTTPS / TLS 1.2 & 1.3 (Port 443, Redirect dari Port 80)
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    NGINX REVERSE PROXY                      │
│ - Terminasi SSL/TLS (Let's Encrypt Certbot)                 │
│ - Header Keamanan OWASP ASVS                                │
│ - Rate Limiting Berlapis (Analyze, Auth, General API)       │
│ - Caching Aset Statis Vite (dist/assets) & Body Limit 30MB  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP Internal (127.0.0.1:3000)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             NODE.JS / EXPRESS BACKEND (systemd)             │
│ - Berjalan sebagai user non-root (www-data)                 │
│ - Scrypt Password Hashing + Timing-Safe JWT HS256           │
│ - Verifikasi Signature SHA-512 & Idempotensi Midtrans       │
│ - Pemrosesan Gambar EKG Ephemeral (Tanpa Simpan Foto Mentah)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 DATA STORE LOKAL (data/db.json)             │
│ - Penulisan atomik & terisolasi dari repositori Git         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Langkah Push ke GitHub

Berkas sensitif (`.env` dan `data/db.json`) sudah otomatis dikecualikan di `.gitignore`, sedangkan template `.env.example`, `.env.production.example`, dan `data/db.example.json` tetap disertakan.

```bash
git init
git branch -M main
git add .
git status   # Pastikan .env dan data/db.json TIDAK ikut ter-stage
git commit -m "feat: release AI ECG Analyzer v1.0.0 ready for VPS deployment"
git remote add origin https://github.com/USERNAME/REPO_NAME.git
git push -u origin main
```

---

## 3. Opsi A — Deployment Langsung di VPS Linux (Systemd + Nginx + Certbot)

### Langkah 1: Arahkan DNS Domain ke IP VPS
Buat DNS Record bertipe `A` pada penyedia domain Anda:
- `ecg.domainanda.com` -> `IP_PUBLIK_VPS_ANDA`

### Langkah 2: Clone Repositori & Isi `.env` Produksi
Masuk ke VPS via SSH, lalu jalankan:
```bash
sudo mkdir -p /var/www/ecg-ai
sudo chown -R $USER:$USER /var/www/ecg-ai
git clone https://github.com/USERNAME/REPO_NAME.git /var/www/ecg-ai
cd /var/www/ecg-ai

cp .env.production.example .env
nano .env
```
Pastikan variabel berikut terisi dengan benar di `.env`:
- `NODE_ENV="production"`
- `HOST="127.0.0.1"` dan `PORT=3000`
- `GEMINI_API_KEY` (dari Google AI Studio)
- `APP_URL="https://ecg.domainanda.com"`
- `JWT_SECRET` (buat acak minimal 32 karakter, contoh: `openssl rand -base64 48`)
- `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, dan `MIDTRANS_IS_PRODUCTION="true"` (atau `"false"` jika masih menggunakan Midtrans Sandbox)

### Langkah 3: Jalankan Skrip Deployment Otomatis
```bash
chmod +x deploy/scripts/deploy-linux.sh
./deploy/scripts/deploy-linux.sh ecg.domainanda.com
```
*(Jika belum memiliki domain dan ingin mengakses lewat IP VPS terlebih dahulu, jalankan `./deploy/scripts/deploy-linux.sh` tanpa argumen domain).*

### Langkah 4: Aktifkan HTTPS Gratis (Let's Encrypt)
```bash
sudo certbot --nginx -d ecg.domainanda.com --redirect
```
Uji perpanjangan otomatis sertifikat SSL:
```bash
sudo certbot renew --dry-run
```

### Langkah 5: Konfigurasi Webhook Midtrans Dashboard
Pada **Midtrans Dashboard -> Settings -> Payment Notification URL**, arahkan ke:
- **Payment Notification URL**: `https://ecg.domainanda.com/api/midtrans/webhook`
- **Finish Redirect URL**: `https://ecg.domainanda.com`

---

## 4. Opsi B — Deployment Menggunakan Docker Compose

Pastikan file `.env` sudah dibuat di root proyek (`/var/www/ecg-ai/.env`), lalu jalankan:

```bash
cd deploy/docker
docker compose up -d --build
```

Memantau log container:
```bash
docker compose logs -f
```

---

## 5. Perintah Operasional Harian (Linux VPS)

| Operasi | Perintah |
|---|---|
| **Cek Status Service** | `sudo systemctl status ecg-ai nginx --no-pager` |
| **Update Kode dari GitHub** | `cd /var/www/ecg-ai && git pull && npm ci --include=dev && npm run build && sudo systemctl restart ecg-ai` |
| **Restart Backend** | `sudo systemctl restart ecg-ai` |
| **Reload Nginx** | `sudo nginx -t && sudo systemctl reload nginx` |
| **Pantau Log Aplikasi** | `sudo journalctl -u ecg-ai -n 100 -f` |
| **Pantau Log Error Nginx** | `sudo tail -n 50 -f /var/log/nginx/error.log` |
| **Cek Health Endpoint** | `curl -s http://127.0.0.1/api/health` |

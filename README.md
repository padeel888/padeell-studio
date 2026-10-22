# Padeel Studio v2 — Bulk Audio Manager
## Fungsi
- Antre hingga **150 audio per batch** (MP3, WAV, OGG, FLAC, maks. 50 MB input/file).
- Editor massal dan individual: nama, volume, pitch, speed, trim, normalize loudness, dan fade, beserta preview dan ekspor MP3.
- Upload ke Roblox Open Cloud resmi dengan **API key** dari pemilik, antrean paralel maksimal 2 permintaan, pause, status, retry dan asset IDs.
- Hasil disimpan di `localStorage` browser (tanpa menyimpan API key); pencarian, filter, salin `rbxassetid://...`, ekspor CSV.
- FFmpeg pada server mengonversi output menjadi MP3 192kbps, membatasi durasi output **7 menit** dan ukuran **20 MB**.

## Menjalankan lokal (Python 3.11+, ffmpeg dan ffprobe tersedia di PATH)

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8080
```

Buka http://127.0.0.1:8080. Atau deploy dengan `docker build -t padeel-v2 .` dan `docker run -p 8080:8080 padeel-v2`.

### Deploy domain HTTPS (reverse proxy)

Set environment variable `PADEEL_PUBLIC_ORIGIN=https://domain-kamu.com` bila domain publik berbeda dari alamat internal reverse proxy. Set konfigurasi reverse proxy sesuai platform; file 50 MB bisa butuh batas request 60 MB dan timeout lebih panjang. Docker image menyertakan ffmpeg.

## Menyiapkan Roblox
1. Masuk ke https://create.roblox.com/dashboard/credentials dan buat Open Cloud API key untuk izin Asset read/write yang diperlukan.
2. Periksa creator/user atau group yang dipilih memang dapat membuat aset. Masukkan ID numeriknya.
3. Klik **Koneksi Roblox** dan masukkan API key. Key disimpan **hanya dalam memori tab** selama terbuka; belum diverifikasi sampai request upload dijalankan.
4. Centang konfirmasi hak pakai audio, klik **Upload antrean**.
5. Perhatikan status moderasi Roblox dan ekspor CSV sebelum menutup/mereset browser. `uploaded` berarti Roblox telah membuat asset dan mengembalikan ID, **bukan** pasti bisa dipakai di semua experience.

**Keterbatasan:** Roblox mendokumentasikan batas 100 audio/bulan untuk identitas terverifikasi, 10/bulan jika belum, dan hingga 7 menit serta 20 MB per unggahan Open Cloud. Antrean 150 tidak menembus batas ini. Setiap audio dikirim sebagai request terpisah. https://create.roblox.com/docs/cloud/guides/usage-assets

## Keamanan dan perilaku penting
- Tidak menggunakan `.ROBLOSECURITY` cookie, endpoint publish legacy, atau bypass keamanan/kuota.
- API key diteruskan hanya ke domain Roblox Open Cloud API oleh server; tidak dicatat atau disimpan oleh aplikasi.
- Perlu HTTPS pada domain publik. Jangan gunakan shared/admin key untuk banyak orang.
- Untuk **layanan publik multi-user**, migrasikan koneksi ke OAuth 2.0 (scope `asset:read` + `asset:write`), autentikasi sesi user, penyimpanan job/riwayat per-akun, CSRF, batasan IP per pengguna, dan scanning berkas. API key pribadi saat ini paling sesuai untuk penggunaan internal/pribadi.
- Jika koneksi putus setelah upload, **cek Creator Dashboard** sebelum mencoba ulang agar tidak menciptakan asset duplikat.
- Hasil yang masih `processing` menampilkan **Cek status**, bukan langsung dianggap gagal. Jika halaman ditutup ketika masih processing, status operation dapat hilang (ekspor/riwayat tersedia untuk hasil yang dikembalikan).
- Untuk 150 file besar, reverse proxy/hosting harus mendukung upload dan resource CPU cukup; preview dan proses konversi FFmpeg dibatasi 2 secara bersamaan.
- Editor mengubah pitch **bersamaan dengan tempo** untuk pitch semitone, sebagaimana editor asli; bukan independen pitch correction.
- API Roblox dapat berubah (Assets API berstatus beta); kode mengacu pada dokumentasi yang diperiksa **22 Oktober 2026**.

## Verifikasi
- Pengujian statis dan lokal dapat dijalankan tanpa akun Roblox.
- **Upload real Roblox tidak dijalankan** karena tidak ada API key/test user. Keberhasilan live tetap bergantung pada key, kuota, moderasi, dan Roblox.

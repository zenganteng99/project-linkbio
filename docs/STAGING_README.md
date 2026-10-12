# 🔐 ADMIN STAGING - Security Update

## Overview
File `admin-staging.html` adalah versi staging dari `admin.html` dengan fitur keamanan baru untuk diuji sebelum diterapkan ke production.

---

## 🛡️ Fitur Keamanan Baru

### 1. Rate Limiting (Brute-Force Protection)
- **Max attempts:** 5 kali percobaan login salah
- **Lockout duration:** 1 menit setelah 5x gagal
- **UI indicator:** Counter percobaan tersisa dan countdown timer
- **Visual feedback:** Tombol berubah merah saat hampir terkunci

### 2. Fitur "Lupa PIN"
Modal interaktif dengan 3 langkah:
1. **Step 1:** Input nomor WhatsApp -> kirim kode verifikasi
2. **Step 2:** Input kode 6 digit -> verifikasi
3. **Step 3:** Input PIN baru 6 digit -> reset PIN

### 3. Keamanan Tambahan
- Validasi input hanya angka untuk PIN
- Cooldown 60 detik untuk kirim ulang kode
- Token-based verification untuk reset PIN

---

## 📁 File Structure

```
project-linkbio/
├── admin.html              # Production (ORIGINAL - DON'T MODIFY YET)
├── admin-staging.html      # Staging version (FOR TESTING)
├── SQL/
│   └── pin_reset_rpc.sql  # RPC functions for Supabase
└── docs/
    └── STAGING_README.md  # This file
```

---

## 🔧 Setup yang Dibutuhkan

### 1. Supabase RPC Functions
Jalankan SQL di `SQL/pin_reset_rpc.sql` untuk menambahkan:
- `request_pin_reset(p_phone)` - Generate & store verification code
- `verify_pin_reset_code(p_phone, p_code, p_token)` - Validate code
- `reset_admin_pin_via_phone(p_phone, p_reset_token, p_new_pin)` - Reset PIN

### 2. Worker Endpoints
Tambahkan endpoint di `worker.js`:
- `POST /api/send-pin-reset-code` - Kirim WhatsApp message
- `POST /api/verify-pin-reset-code` - Verifikasi kode

### 3. WhatsApp Integration
Gunakan API WhatsApp (misal: Fonnte, WaBlas) untuk kirim pesan dengan kode verifikasi.

---

## 🧪 Testing Checklist

- [ ] Rate limiting berfungsi (5x gagal -> lockout)
- [ ] Countdown timer tampil saat locked
- [ ] Modal "Lupa PIN" bisa dibuka
- [ ] Kode verifikasi hanya angka (6 digit)
- [ ] Tombol Kirim Ulang aktif setelah 60 detik
- [ ] Reset PIN berhasil disimpan ke database
- [ ] Success modal tampil setelah reset

---

## ⚠️ Catatan Penting

1. **JANGAN** langsung modify `admin.html` sebelum staging teruji
2. Test di environment lokal atau subdomain staging
3. Pastikan semua link dan fungsi berjalan dengan baik
4. Backup database sebelum test reset PIN
5. Hapus banner staging sebelum deploy ke production

---

## 📞 Alur Reset PIN

```
User klik "Lupa PIN?"
       ↓
Input nomor WhatsApp
       ↓
POST /api/send-pin-reset-code
       ↓
WhatsApp terima kode (6 digit)
       ↓
Input kode verifikasi
       ↓
POST /api/verify-pin-reset-code
       ↓
Input PIN baru (6 digit)
       ↓
RPC reset_admin_pin_via_phone
       ↓
Success! Login dengan PIN baru
```

---

## 🔒 Keamanan

- Kode verifikasi expires dalam 10 menit
- Rate limit 3 request kode per jam per nomor
- Reset token single-use
- Hash PIN sebelum simpan

---

**Last Updated:** 2026-10-11
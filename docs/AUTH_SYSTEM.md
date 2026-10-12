# Admin Staging - Authentication System

## 🔐 Sistem Autentikasi Profesional

Versi ini menggunakan sistem autentikasi berbasis **Password Alphanumeric** yang setara dengan standar industri global (Meta, Twitter, dll).

---

## 📋 Fitur Keamanan

### 1. Password Alphanumeric
- Minimal 8 karakter
- Mendukung huruf besar, huruf kecil, angka, dan simbol
- Hash menggunakan bcrypt/scrypt di server
- Tidak ada batasan karakter khusus

### 2. Rate Limiting
- Max 5 percobaan login salah
- Lockout 1 menit setelah 5x gagal
- Countdown timer saat terkunci
- Counter percobaan tersisa

### 3. Password Recovery (Email-Based)
- Step 1: Input email terdaftar
- Step 2: Input OTP 6 digit dari email
- Step 3: Buat password baru (min. 8 karakter)
- Resend timer 60 detik

---

## 🔧 Setup yang Dibutuhkan

### 1. Supabase RPC Functions
Jalankan `SQL/password_reset_rpc.sql`

### 2. Worker Endpoints
- `POST /api/send-password-reset-email`
- `POST /api/verify-password-reset-code`
- `POST /api/reset-admin-password-via-email`

### 3. Email Integration
Konfigurasi SMTP/Resend API untuk pengiriman email reset password.

---

## 📁 File Structure

```
admin-staging.html        # Frontend dengan sistem password
SQL/
  password_reset_rpc.sql  # Server-side functions
worker/
  password-reset-handler.js  # API endpoints
```
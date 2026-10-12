# 🧪 Testing Guide - Admin Staging

## Prerequisites
1. Jalankan SQL di `SQL/pin_reset_rpc.sql` di Supabase
2. Tambahkan endpoint ke `worker.js` (lihat `worker/pin-reset-handler.js`)
3. Konfigurasi WhatsApp API di worker secrets

---

## Test Cases

### TC-01: Rate Limiting
| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Buka `admin-staging.html` | Halaman login tampil normal |
| 2 | Masukkan slug: `default`, PIN: `123456` | Login gagal, error tampil |
| 3 | Ulangi step 2 sampai 5x | Counter tampil "Percobaan tersisa: 1" |
| 4 | Klik login lagi (6x) | Tombol terkunci, warning tampil |
| 5 | Tunggu 60 detik | Countdown timer tampil |
| 6 | Setelah 60 detik | "Akses Dipulihkan" toast, bisa login lagi |

### TC-02: Forgot PIN Flow
| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Klik "Lupa PIN?" | Modal terbuka |
| 2 | Masukkan nomor tidak valid | Error "Nomor tidak valid" |
| 3 | Masukkan nomor valid | Loading spinner, step 2 tampil |
| 4 | Input kode 6 digit, tekan Enter | Verifikasi, step 3 tampil |
| 5 | Masukkan PIN baru 6 digit | Berhasil, modal sukses tampil |
| 6 | Klik "Masuk dengan PIN Baru" | Fokus ke input PIN |

### TC-03: Resend Code Timer
| Step | Action | Expected Result |
|------|--------|----------------|
| 1 | Buka modal Lupa PIN | Step 1 tampil |
| 2 | Kirim kode verifikasi | Loading, step 2 tampil |
| 3 | Klik "Kirim Ulang" | Error "Kirim ulang dalam X detik" |
| 4 | Tunggu 60 detik | Tombol aktif kembali |

### TC-04: Input Validation
| Input | Test | Expected |
|-------|------|----------|
| Kode verifikasi | Ketik huruf | Hanya angka yang tampil |
| PIN baru | Ketik huruf | Hanya angka yang tampil |
| Konfirmasi PIN | Ketik huruf | Hanya angka yang tampil |
| PIN baru | < 6 digit | Error "PIN 6 digit" |
| Konfirmasi PIN | Tidak sama | Error "PIN tidak cocok" |

---

## Manual Testing Checklist

- [ ] Rate limiting aktif (5x gagal -> lockout)
- [ ] Countdown timer berfungsi
- [ ] Tombol berubah merah saat hampir terkunci
- [ ] Modal Lupa PIN bisa dibuka
- [ ] Step 1 -> 2 -> 3 flow berfungsi
- [ ] Kode hanya angka
- [ ] Resend timer 60 detik
- [ ] Reset PIN berhasil
- [ ] Success modal tampil
- [ ] Focus ke PIN setelah close modal
- [ ] Banner staging terlihat jelas
- [ ] Staging info banner tampil
- [ ] Enter key berfungsi di login
- [ ] Enter key berfungsi di verifikasi

---

## Automated Test (Browser Console)

```javascript
// Test rate limiting
console.log("Testing rate limiting...");

// Clear localStorage
localStorage.removeItem("admin_login_attempts_staging");
localStorage.removeItem("admin_login_lockout_staging");

// Check functions exist
console.log("isLocked:", typeof isLocked);
console.log("updateRLUI:", typeof updateRLUI);
console.log("handleLogin:", typeof handleLogin);
console.log("openForgotModal:", typeof openForgotModal);

// Test UI elements
console.log("Login button:", !!document.getElementById("login-btn"));
console.log("Rate limit warning:", !!document.getElementById("rate-limit-warning"));
console.log("Forgot modal:", !!document.getElementById("forgot-pin-modal"));
```

---

## Report Bug
Jika menemukan bug, sertakan:
1. Browser & versi
2. Langkah reproduksi
3. Screenshot error
4. Console log (jika ada)
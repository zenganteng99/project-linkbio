# 🚀 Deployment Guide - Admin Security Update

## 📁 File yang Dibuat

```
project-linkbio/
├── admin-staging.html           # NEW - Staging version dengan fitur keamanan
├── admin.html                   # Original production (belum dimodifikasi)
├── docs/
│   ├── STAGING_README.md       # Dokumentasi fitur keamanan
│   └── TESTING_GUIDE.md        # Panduan testing
├── SQL/
│   └── pin_reset_rpc.sql       # RPC functions untuk Supabase
└── worker/
    └── pin-reset-handler.js     # Endpoint handlers untuk worker
```

---

## ⚡ Quick Start (Testing Only)

### 1. Buka File Staging
```
file:///C:/Users/Zen%20Asegaf/Documents/project-linkbio/admin-staging.html
```

atau serve via local server:
```bash
npx serve .
# Buka http://localhost:3000/admin-staging.html
```

### 2. Test Rate Limiting
- Login dengan PIN salah 5x
- Pastikan terkunci 1 menit
- Pastikan countdown timer berfungsi

### 3. Test Forgot PIN
- Klik "Lupa PIN?"
- Masukkan nomor WhatsApp
- Verifikasi dengan kode (akan error sampai endpoint selesai)

---

## 🔧 Setup Production (Setelah Testing)

### Step 1: Deploy SQL Functions
1. Buka [Supabase Dashboard](https://supabase.com/dashboard)
2. SQL Editor > New Query
3. Copy isi `SQL/pin_reset_rpc.sql`
4. Execute

### Step 2: Deploy Worker Endpoints
1. Copy isi `worker/pin-reset-handler.js`
2. Paste ke `worker/worker.js` sebelum `export default`
3. Tambahkan routes di fetch handler:
```javascript
if (url.pathname === "/api/send-pin-reset-code" && request.method === "POST") return handleSendPinResetCode(request, env);
if (url.pathname === "/api/verify-pin-reset-code" && request.method === "POST") return handleVerifyPinResetCode(request, env);
```

### Step 3: Configure WhatsApp API
```bash
# Set worker secret
npx wrangler secret put WHATSAPP_API_TOKEN
# Masukkan token dari Fonnte/WaBlas
```

### Step 4: Deploy Worker
```bash
cd worker
npx wrangler deploy
```

### Step 5: Deploy to Production
1. Test semua fitur di staging
2. Copy `admin-staging.html` → `admin.html`
3. Hapus banner staging:
```javascript
// Hapus baris ini dari admin.html:
<div class="bg-gradient-to-r from-yellow-400...">STAGING...</div>
// Hapus juga:
// 1. Banner info staging
// 2. Ganti title jadi "Admin Panel - Bio Link"
// 3. Ganti "admin-staging.html" references
```

---

## ⚠️ Checklist Sebelum Production

- [ ] Rate limiting berfungsi
- [ ] Forgot PIN modal berfungsi
- [ ] WhatsApp message terkirim
- [ ] PIN berhasil di-reset
- [ ] Banner staging dihapus
- [ ] Title dikembalikan
- [ ] Backup database dibuat
- [ ] Log monitoring aktif

---

## 🔄 Rollback Plan

Jika ada masalah:
1. Revert `admin.html` ke versi sebelumnya
2. Tidak perlu revert SQL (compatible)
3. Worker endpoints tidak perlu di-revert

---

## 📞 Support

Jika ada pertanyaan:
1. Baca `docs/STAGING_README.md`
2. Baca `docs/TESTING_GUIDE.md`
3. Check worker logs: `npx wrangler tail`

---

**Status:** ✅ Staging Ready for Testing
**Last Updated:** 2026-10-11
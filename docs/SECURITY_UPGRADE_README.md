# 🔐 Security Upgrade Guide - Seamless Migration

## 📋 Ringkasan

Script `SQL/security_upgrade.sql` melakukan upgrade sistem autentikasi dari PIN ke Password dengan prinsip **seamless migration** - pengguna lama tidak akan terkunci.

---

## 🚀 Cara Eksekusi

1. Buka [Supabase Dashboard](https://supabase.com/dashboard)
2. Pilih project Anda
3. SQL Editor > New Query
4. Copy isi file `SQL/security_upgrade.sql`
5. Execute (Run)

---

## 📦 Apa yang Dibuat

### 1. Schema Updates
```sql
- EXTENSION pgcrypto (untuk bcrypt hashing)
- COLUMN admin_email (TEXT, UNIQUE)
- COLUMN admin_password (TEXT, hashed)
- COLUMN migration_status
- COLUMN updated_at
```

### 2. Functions Baru

| Function | Fungsi |
|----------|--------|
| `verify_admin_login` | Hybrid login (PIN lama + Password baru) |
| `update_security_credentials` | Force security update |
| `request_password_reset` | Request reset via email |
| `verify_password_reset_code` | Verify OTP |
| `reset_admin_password_via_email` | Reset password |
| `cleanup_expired_password_codes` | Cleanup expired codes |

### 3. View
```sql
security_migration_status - Lihat status migrasi semua user
```

---

## 🔄 Alur Hybrid Login

```
User Login
    │
    ├─► admin_password ADA?
    │       │
    │       ├─► YES: Verifikasi bcrypt hash ✓
    │       │
    │       └─► NO: Cek admin_pin (legacy)
    │               │
    │               ├─► PIN cocok: Login BERHASIL
    │               │           └─► needs_security_update = TRUE
    │               │               (karena belum punya email)
    │               │
    │               └─► PIN salah: Login GAGAL
```

---

## 📧 Fitur Password Reset via Email

1. **Rate Limiting:** Max 3 request per jam per email
2. **OTP 6 digit:** Valid 10 menit
3. **Single-use token:** Reset token regenerate setelah verifikasi
4. **Security:** Tidak ada email enumeration (selalu return success)

---

## 🧪 Testing

### Test Legacy User (PIN):
```sql
SELECT verify_admin_login('default', '123456');
-- Returns: needs_security_update = true (karena belum ada email)
```

### Test Migrated User (Password):
```sql
-- Pertama, migrate user:
SELECT update_security_credentials('default', '123456', 'admin@example.com', 'SecurePass123');

-- Login dengan password baru:
SELECT verify_admin_login('default', 'SecurePass123');
-- Returns: needs_security_update = false
```

### Test Password Reset:
```sql
-- 1. Request reset
SELECT request_password_reset('admin@example.com');

-- 2. Verifikasi OTP (pakai token dari step 1)
SELECT verify_password_reset_code('admin@example.com', '123456', 'token_dari_step1');

-- 3. Reset password (pakai reset_token dari step 2)
SELECT reset_admin_password_via_email('admin@example.com', 'reset_token_dari_step2', 'PasswordBaru123');
```

### Check Migration Status:
```sql
SELECT * FROM security_migration_status;
```

---

## ⚠️ Catatan Penting

1. **Backup dulu:** Sebaiknya backup database sebelum eksekusi
2. **Test di staging:** Jangan langsung ke production
3. **User lama tidak terkunci:** Bisa login dengan PIN lama
4. **Akan diminta upgrade:** Setelah login, popup akan muncul untuk set email & password baru
5. **PIN di-clear setelah migrasi:** admin_pin = NULL setelah upgrade

---

## 📁 File Pendukung

```
SQL/
├── security_upgrade.sql    # Script utama (EKSEKUSI INI)
├── password_reset_rpc.sql # Legacy (bisa diabaikan)
└── pin_reset_rpc.sql      # Legacy (bisa diabaikan)

docs/
└── SECURITY_UPGRADE_README.md  # Dokumen ini
```

---

## 🔒 Keamanan

- Password di-hash dengan **bcrypt** (gen_salt('bf'))
- Rate limiting pada request reset
- Token single-use
- SQL injection protection (parameterized queries)
- Email enumeration prevention

---

## ✅ Checklist Deployment

- [ ] Backup database
- [ ] Execute SQL script
- [ ] Test legacy login (PIN)
- [ ] Test migration flow
- [ ] Test password reset via email
- [ ] Update frontend admin-staging.html
- [ ] Setup email worker endpoint
- [ ] Monitor migration status

---

**Script siap dieksekusi!** 🚀
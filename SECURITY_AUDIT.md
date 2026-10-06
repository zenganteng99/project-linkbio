# 🔐 SECURITY AUDIT - customlink.id

## Risk Score: 🔴 9.2/10 (CRITICAL)

---

## 🚨 TOP 5 EMERGENCY FIXES

### 1. ENABLE RLS (15 min)
`supabase_setup.sql` - RLS currently DISABLED
- Remove: `ALTER TABLE settings DISABLE ROW LEVEL SECURITY;`
- Remove: `ALTER TABLE products DISABLE ROW LEVEL SECURITY;`

### 2. SECURE STORAGE (10 min)
`storage_policy.sql` - Currently public READ/WRITE/DELETE
- Delete: "Public INSERT/UPDATE/DELETE on public-assets" policies

### 3. DELETE KEYS (5 min)
Delete these files NOW:
- `dana_key.txt`
- `pkcs8_rsa_private_key.pem`
- `private_key.pem`

### 4. CHANGE ALL PINS (5 min)
`supabase_setup.sql:19` - Default PIN is "123456"
```sql
UPDATE settings SET admin_pin = encode(gen_random_bytes(6), 'hex') 
WHERE admin_pin = '123456';
```

### 5. WEBHOOK VERIFICATION (1 hour)
`worker.js` - No signature verification
- Add X-SIGNATURE header validation before processing
- Prevent fake payment notifications

---

## 📊 ISSUE SUMMARY

| Severity | Count | Examples |
|----------|-------|----------|
| CRITICAL | 5 | RLS off, Open storage, Keys exposed |
| HIGH | 7 | CORS *, No rate limit, No validation |
| MEDIUM | 8 | Weak auth, No logging, Hardcoded URLs |
| LOW | 6 | Duplicate keys, Debug scripts |

---

## 🔴 CRITICAL ISSUES

| ID | Issue | Impact |
|----|-------|--------|
| C-01 | Row Level Security DISABLED | All data exposed |
| C-02 | Storage Bucket OPEN | Malware upload possible |
| C-03 | Private Keys in Repo | Payment fraud risk |
| C-04 | Default PIN "123456" | Easy brute force |
| C-05 | No Webhook Verify | Fake payments possible |

---

## 🟠 HIGH ISSUES

| ID | Issue | Impact |
|----|-------|--------|
| H-01 | CORS "*" | CSRF attacks |
| H-02 | No Rate Limit | Bruteforce/DoS |
| H-03 | No Input Validation | XSS/SQL injection |
| H-04 | Hardcoded Credentials | Maintenance risk |
| H-05 | sessionStorage sensitive | XSS data theft |

---

## 📁 SENSITIVE FILES

```
DELETE IMMEDIATELY:
├── dana_key.txt
├── pkcs8_rsa_private_key.pem
└── private_key.pem

SET AS SECRETS (not in repo):
├── worker/wrangler.toml (has merchant IDs)
└── tools/dana-diagnose/ (has credentials)
```

---

## ✅ QUICK FIXES

### Day 1 - Emergency (2 hours)
```bash
# 1. Enable RLS
# 2. Secure storage
# 3. Delete keys
# 4. Change PINs
# 5. Add webhook verify
```

### Day 7 - Critical (4 hours)
```bash
# 1. Rate limiting
# 2. Input validation
# 3. Security headers
# 4. Error handling
```

### Day 30 - Important (8 hours)
```bash
# 1. Auth system
# 2. Audit logging
# 3. Payment idempotency
# 4. Security testing
```

---

## 📞 EMERGENCY CONTACTS

- Cloudflare: workers.cloudflare.com
- Supabase: supabase.com/dashboard
- DANA SNAP: snap@dana.id

---

**Full Report:** `SECURITY_AUDIT_FULL.md`

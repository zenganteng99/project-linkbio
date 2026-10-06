# Security Audit - customlink.id

## Risk Score: 9.2/10 (CRITICAL)

---

## TOP 5 EMERGENCY FIXES

### 1. ENABLE RLS (15 min)
`supabase_setup.sql` - RLS DISABLED

### 2. SECURE STORAGE (10 min)
`storage_policy.sql` - Public RW enabled

### 3. DELETE KEYS (5 min)
- dana_key.txt
- pkcs8_rsa_private_key.pem
- private_key.pem

### 4. CHANGE ALL PINS (5 min)
Default PIN is "123456"

### 5. WEBHOOK VERIFY (1 hour)
`worker.js` - No signature verification

---

## QUICK FIX COMMANDS

```bash
# Delete exposed keys
del dana_key.txt pkcs8_rsa_private_key.pem private_key.pem

# Set new DANA secret
wrangler secret put DANA_PRIVATE_KEY
```

```sql
-- Enable RLS
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Change default PINs
UPDATE settings SET admin_pin = encode(gen_random_bytes(6), 'hex')
WHERE admin_pin = '123456';
```

---

## FULL REPORT: See project files for detailed analysis

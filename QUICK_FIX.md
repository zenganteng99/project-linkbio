# 🔴 CRITICAL SECURITY ISSUES - customlink.id

## IMMEDIATE ACTION REQUIRED

### ISSUE #1: DATABASE RLS DISABLED
**File:** `supabase_setup.sql:46-47`
```sql
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
```
**Impact:** All client data exposed to public

### ISSUE #2: STORAGE BUCKET OPEN
**File:** `storage_policy.sql:35-55`
- Public INSERT, UPDATE, DELETE allowed
- Attacker can upload malware

### ISSUE #3: PRIVATE KEYS EXPOSED
**Files:** `dana_key.txt`, `pkcs8_rsa_private_key.pem`, `private_key.pem`
**Impact:** Payment fraud possible if repo breached

### ISSUE #4: DEFAULT PIN "123456"
**File:** `supabase_setup.sql:19`
**Impact:** Easy bruteforce

### ISSUE #5: NO WEBHOOK VERIFICATION
**File:** `worker/worker.js` - `handleGapuraWebhook()`
**Impact:** Fake payment notifications possible

---

## QUICK FIX

```sql
-- Enable RLS
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Create read policies
CREATE POLICY "settings_read" ON settings FOR SELECT USING (true);
CREATE POLICY "products_read" ON products FOR SELECT USING (true);

-- Change default PINs
UPDATE settings SET admin_pin = encode(gen_random_bytes(6), 'hex')
WHERE admin_pin = '123456';
```

```bash
# Delete exposed keys
del dana_key.txt pkcs8_rsa_private_key.pem private_key.pem
```

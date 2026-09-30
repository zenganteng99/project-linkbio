# tools/dana-diagnose — Diagnosa Error Pembayaran DANA

Folder ini **terpisah dari kode produksi**: tool di sini tidak pernah dipanggil oleh `worker/worker.js`.
Tujuannya: mengisolasi penyebab error pembayaran (contoh nyata: `HTTP 404 - [4045408] Invalid Merchant`)
dengan mengirim **beberapa varian payload** ke DANA lalu membandingkan responsnya.

## 0. Akar masalah yang sudah TERBUKTI (dari API Logs dashboard DANA)

Respon asli DANA (menu **API Logs**, 30/09/2026) untuk `POST /payment-gateway/v1.0/debit/payment-host-to-host.htm`:

```json
{
  "partnerReferenceNo": "ORDER-1790741307317",
  "additionalInfo": { "debugMessage": "DIVISION_NOT_EXIST:division not exist" },
  "responseCode": "4045408",
  "responseMessage": "Invalid Merchant"
}
```

| Bukti di log | Spesifikasi DANA | Status |
|---|---|---|
| `subMerchantId: 216660000003605019003` | `subMerchantId` = **externalDivisionId** yang terdaftar. `216660000003605019003` adalah kolom **External Shop ID** (tab *Shop*), bukan Division | **PENYEBAB 4045408** |
| `CHANNEL-ID: 2026092618040865582354-SERVER` (29 char) | `CHANNEL-ID`: **1-5 karakter**; Sample Payload dashboard = `95221` | melanggar spec |
| `X-TIMESTAMP: ...+00:00` | wajib `YYYY-MM-DDTHH:mm:ss+07:00` (GMT+7, 25 char) | melanggar spec |
| `ORIGIN: https://customlink-webhook.modernshopp.workers.dev` | `ORIGIN` = domain aplikasi terdaftar (`env.DANA_ORIGIN`) | `worker.js` mengabaikan `DANA_ORIGIN` |

Nilai yang benar (dashboard → *Account Information* → *Submerchants*):

| Kolom | Nilai | Dipakai untuk |
|---|---|---|
| Merchant ID | `216620090026052421673` | `merchantId` |
| External Division ID | `d5831d89` | **`subMerchantId`** |
| External Shop ID | `7b7c6a5f` | `externalStoreId` (opsional) |

> Ringkasnya: **jangan pernah mengirim External Shop ID / Division ID internal sebagai `subMerchantId`.**
> DANA akan selalu menjawab `4045408` + `DIVISION_NOT_EXIST`.


Arti kode error yang sedang diburu (sumber: [DANA API Docs — Create Order Hosted Checkout](https://gateway-mp-sit.dana.id/api-docs-v2/api/payment-gateway/create-order-hosted)):

| Kode | HTTP | Arti |
|---|---|---|
| `4045408` | 404 | **Invalid Merchant** — "Merchant does not exist or status abnormal" |
| `4015400` | 401 | Unauthorized / Invalid Signature |
| `4005401` / `4005402` | 400 | Invalid Field Format / Invalid Mandatory Field |
| `4045418` | 404 | Inconsistent Request (`partnerReferenceNo` sama, payload beda) |
| `2005400` | 200 | Successful |

Endpoint yang diuji: `POST /payment-gateway/v1.0/debit/payment-host-to-host.htm`
(sandbox: `https://api.sandbox.dana.id`) — sama persis dengan `worker/worker.js:19`.

---

## 1. Varian yang diuji (yang membedakan tiap request)

| id | Perbedaan vs produksi | Hipotesis yang diuji |
|---|---|---|
| `baseline` | tidak ada — persis `worker.js` lama | pembanding |
| `no-submerchant` | `subMerchantId` tidak dikirim | **H3** — `worker.js:153` (lama) selalu mengirim `subMerchantId` hardcoded `216660000003605019003` (External **Shop** ID) |
| `division-id` | `subMerchantId` = External Division ID resmi (`d5831d89`) + `ORIGIN` terdaftar + GMT+7 + CHANNEL-ID 1-5 char | **H3-fix** — konfigurasi yang sudah dipatch ke `worker.js`; kalau ini sukses, akar masalah benar-benar `subMerchantId` |
| `registered-origin` | `ORIGIN` = domain terdaftar (`DANA_ORIGIN`) | **H4** — `worker.js:149` (lama) mengirim origin Worker (`*.workers.dev`), bukan origin aplikasi |
| `spec-timestamp` | `X-TIMESTAMP` = GMT+7 (`+07:00`) | **H5** — `worker.js:56-61` (lama) mengirim UTC (`+00:00`), docs DANA mewajibkan GMT+7 |
| `short-channel` | `CHANNEL-ID` 1-5 karakter (`95221`) | **H6** — `worker.js:192` (lama) mengirim `clientId + "-SERVER"` (29 karakter, spec: 1-5) |
| `clean` | gabungan `no-submerchant` + `registered-origin` + `spec-timestamp` + CHANNEL-ID | kandidat konfigurasi bersih **bila tidak memakai skema Division** |

## 2. Cara pakai tercepat (tanpa deploy, tanpa menyentuh produksi)

```powershell
# 0) (opsional) validasi tool tanpa kredensial & tanpa jaringan
powershell -File .\tools\dana-diagnose\run-diagnose.ps1 -SelfTest

# 1) lihat dulu request yang AKAN dikirim (dry run, tidak ada request ke DANA)
powershell -File .\tools\dana-diagnose\run-diagnose.ps1 -DryRun

# 2) siapkan kredensial
Copy-Item .\tools\dana-diagnose\env.local.example .\tools\dana-diagnose\env.local
notepad .\tools\dana-diagnose\env.local      # isi DANA_PRIVATE_KEY_PATH / DANA_PRIVATE_KEY

# 3) kirim request NYATA ke DANA sandbox (mulai dari yang paling penting)
powershell -File .\tools\dana-diagnose\run-diagnose.ps1 -Live -Variant baseline,division-id

# 4) kalau masih gagal, uji semua varian dan simpan hasilnya
powershell -File .\tools\dana-diagnose\run-diagnose.ps1 -Live -Variant all -Json > .\diag-hasil.json
```

Tanpa wrapper PowerShell:

```powershell
node .\tools\dana-diagnose\diagnose.mjs --self-test
node .\tools\dana-diagnose\diagnose.mjs --dry-run --variant all
node .\tools\dana-diagnose\diagnose.mjs --live --variant no-submerchant
node .\tools\dana-diagnose\diagnose.mjs --help
```

Exit code: `0` = ada varian yang sukses · `1` = semua varian ditolak DANA · `2` = konfigurasi belum lengkap.

## 3. Cara pakai lewat `wrangler dev` (REST + curl/PowerShell)

```powershell
cd .\tools\dana-diagnose
Copy-Item .dev.vars.example .dev.vars      # isi DANA_PRIVATE_KEY
npx wrangler dev --port 8787

# di terminal lain:
Invoke-RestMethod http://127.0.0.1:8787/api/preflight | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/diagnose -ContentType 'application/json' `
  -Body '{"variant":"all","live":false}' | ConvertTo-Json -Depth 8
# kirim request nyata ke DANA:
Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/diagnose -ContentType 'application/json' `
  -Body '{"variant":"baseline,no-submerchant","live":true}' | ConvertTo-Json -Depth 8
```

> `worker-diagnose.mjs` **default dry-run**. Request nyata hanya bila body berisi `"live": true`.
> **Jangan** jalankan `wrangler deploy` dari folder ini.

## 4. Membaca hasil — matriks kesimpulan

Tool mencetak bagian **KESIMPULAN OTOMATIS**. Aturan interpretasinya:

| Pola hasil | Kesimpulan | Tindakan |
|---|---|---|
| `baseline` gagal, `no-submerchant` **sukses** | `subMerchantId` (`worker.js:153` lama) terisi nilai yang tidak terdaftar sebagai division | kosongkan `SUB_MERCHANT_ID`, atau isi dengan External Division ID resmi dari `dashboard.dana.id/sandbox/submerchants` (tab *Division*) |
| `baseline` gagal, `division-id` **sukses** | konfigurasi sudah benar seperti patch sekarang | pertahankan `SUB_MERCHANT_ID` = External Division ID, redeploy |
| `division-id` gagal + `debugMessage` memuat `DIVISION_NOT_EXIST` | division belum terdaftar / nilainya bukan externalDivisionId | kosongkan `SUB_MERCHANT_ID` (field tidak dikirim) lalu coba lagi |
| `baseline` gagal, `registered-origin` **sukses** | `ORIGIN` (`worker.js:149`) tidak dikenali DANA | pakai `env.DANA_ORIGIN`, jangan `new URL(request.url).origin` |
| `baseline` gagal, `spec-timestamp` **sukses** | format `X-TIMESTAMP` (`worker.js:56-61`) ditolak | ubah ke GMT+7 (`+07:00`) |
| **semua** varian gagal `4045408` | masalah **identitas/status merchant**, bukan header/payload | cek dashboard DANA: company registration selesai, produk **Gapura Hosted Checkout** dipilih, `MERCHANT_ID` + `CLIENT_ID` disalin dari mode Sandbox, private key cocok |
| ada respons `4015400` | `DANA_PRIVATE_KEY` bukan pasangan `CLIENT_ID` | samakan pasangan kunci <-> clientId untuk environment tersebut |
| ada respons `4005401` / `4005402` | format/field wajib tidak sesuai | lihat daftar bagian **PREFLIGHT** |
| `networkError` pada baseline | request tidak keluar dari Worker | cek DNS/firewall/proxy, bukan masalah merchant |

### Kenapa `4045408` dulu "salah arah"
Sebelum patch, `worker/worker.js` memetakan **semua** error non-OK dari DANA menjadi `HTTP 502`. Jadi di DevTools
error ini muncul sebagai `502 (Bad Gateway)` — seolah masalah infrastruktur, padahal DANA membalas
`HTTP 404` + `4045408`. Setelah patch, **status HTTP DANA diteruskan apa adanya** (`404`, dst.), dan
`responseCode` + `additionalInfo.debugMessage` ikut dikembalikan ke frontend serta dicatat di
**Workers Logs** dalam bentuk `[DANA create-payment] ditolak {...}`. Body asli juga selalu dicetak oleh tool ini.

### Patch yang sudah diterapkan ke produksi

| File / fungsi | Perubahan |
|---|---|
| `worker/worker.js` → `snapTimestamp()` | `X-TIMESTAMP` kini GMT+7 (`+07:00`, 25 karakter) sesuai spec SNAP |
| `worker/worker.js` → `handleCreatePayment` | `ORIGIN` = `env.DANA_ORIGIN \|\| PAGES_ORIGIN` (tidak lagi memakai origin Worker) |
| `worker/worker.js` → body request | `subMerchantId` **hanya** dikirim bila `env.SUB_MERCHANT_ID` diisi; fallback hardcoded Shop ID `216660000003605019003` dihapus |
| `worker/worker.js` → body request | `externalStoreId` opsional dari `env.EXTERNAL_STORE_ID` (External Shop ID) |
| `worker/worker.js` → `resolveChannelId()` | `CHANNEL-ID` dari `env.DANA_CHANNEL_ID`, divalidasi maksimal 5 karakter, default `95221` |
| `worker/worker.js` → error handling | status HTTP DANA diteruskan (4xx asli; 5xx → 502), `responseCode` + `debugMessage` dikembalikan & di-log |
| `worker/wrangler.toml` → `[vars]` | `DANA_ORIGIN`, `SUB_MERCHANT_ID = "d5831d89"`, `DANA_CHANNEL_ID = "95221"` (+ komentar `EXTERNAL_STORE_ID`) |

Deploy & uji cepat:

```powershell
cd .\worker
npx wrangler deploy

# uji end-to-end (nominal kecil agar riwayat sandbox bersih)
$body = '{"buyerName":"Tes Sandbox","buyerPhone":"08120000000","packageName":"Starter Package","amount":1000}'
$r = Invoke-RestMethod -Method Post https://customlink-webhook.modernshopp.workers.dev/api/create-payment `
       -ContentType 'application/json' -Body $body
$r | ConvertTo-Json -Depth 6      # sukses -> success = true + paymentUrl
Start-Process $r.paymentUrl       # selesaikan pembayaran di halaman DANA sandbox
```

Kalau masih `4045408`, baca `debugMessage` pada body respons:

| `debugMessage` | Arti | Tindakan |
|---|---|---|
| `DIVISION_NOT_EXIST` | `SUB_MERCHANT_ID` bukan externalDivisionId yang terdaftar | hapus/komentari `SUB_MERCHANT_ID` di `wrangler.toml` → worker tidak mengirim field itu → deploy ulang |
| `MERCHANT_NOT_EXIST` | `MERCHANT_ID` bukan milik environment ini | samakan dengan nilai dashboard Sandbox |
| kosong + `4015400` | `DANA_PRIVATE_KEY` tidak cocok | pasangkan private key dengan `CLIENT_ID` environment yang sama |

## 5. Batasan & catatan keamanan

- Setiap varian membuat **order baru** di DANA (sandbox). Gunakan nominal kecil (`--amount 1000`)
  bila tidak ingin order uji senilai Rp 285.000 muncul di riwayat sandbox.
- Jeda antar request default 1,2 detik (`--delay`) agar tidak menabrak limit/rate-limit.
- `partnerReferenceNo` tiap varian **selalu unik** (`DIAG-<VARIAN>-<timestamp>`) supaya tidak
  kena `4045418 Inconsistent Request`, dan `X-EXTERNAL-ID` juga unik agar tidak kena `409 Conflict`.
- Tool **tidak pernah** menampilkan `DANA_PRIVATE_KEY`. `X-SIGNATURE` selalu diredaksi
  (`abcd1234...wxyz (344 char)`).
- Kredensial hanya dibaca dari file/env lokal (`env.local`, `.dev.vars`) — keduanya
  **jangan** di-commit (sudah masuk `.gitignore`).
- Jalankan varian **berurutan**, bukan paralel, agar hasilnya mudah diinterpretasi.

## 6. Referensi

- Create Order (Hosted Checkout) — endpoint, header, body, daftar kode respons:
  <https://gateway-mp-sit.dana.id/api-docs-v2/api/payment-gateway/create-order-hosted>
- Gapura Hosted Checkout — prasyarat ("Before you start"): company registration, pilih
  produk sebagai payment solution, setup webhook & redirect URL, ambil testing credentials:
  <https://gateway-mp-sit.dana.id/api-docs-v2/guide/payment-gateway/hosted-checkout>
- Integration Overview / Apply for Production — kredensial sandbox **berbeda** dari production:
  <https://gateway-mp-sit.dana.id/api-docs-v2/guide/getting-started/integration-overview>
- Division (Sub-Merchant) — `externalDivisionId` harus terdaftar sebelum dipakai:
  <https://gateway-mp-sit.dana.id/api-docs-v2/guide/merchant-management/division>
- SDK resmi DANA (daftar kredensial wajib: `MERCHANT_ID`, `X_PARTNER_ID`, `PRIVATE_KEY`, `ORIGIN`, `X_DEBUG`):
  <https://github.com/dana-id/dana-node>

## 7. Isi folder

| File | Fungsi |
|---|---|
| `dana-diagnose-core.mjs` | logika bersama (Web API standar; jalan di Node **dan** Workers). Cermin `worker/worker.js` untuk bagian tanda tangan/timestamp/body |
| `diagnose.mjs` | CLI Node: `--self-test` (offline), `--dry-run`, `--live`, `--json` |
| `run-diagnose.ps1` | wrapper PowerShell (memaksa format angka invariant, cek Node, cek file env) |
| `worker-diagnose.mjs` | endpoint REST **lokal** untuk `wrangler dev` (`/api/preflight`, `/api/diagnose`) |
| `wrangler.toml` | konfigurasi khusus `wrangler dev` (nama `*-local`, `workers_dev = false`) |
| `env.local.example` | template kredensial untuk CLI |
| `.dev.vars.example` | template kredensial untuk `wrangler dev` |


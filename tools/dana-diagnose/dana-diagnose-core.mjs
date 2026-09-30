/*
 * dana-diagnose-core.mjs
 * ---------------------------------------------------------------------------
 * Inti tool diagnosa untuk panggilan DANA SNAP "Create Order (Hosted Checkout)"
 * yang dipakai oleh worker/worker.js.
 *
 * Tujuan  : mengisolasi PENYEBAB error `4045408 Invalid Merchant` dengan
 *           mengirim beberapa VARIAN payload ke DANA lalu membandingkan respons.
 * Sifat   : DIAGNOSTIK / READ-ONLY terhadap kode produksi. File ini TIDAK
 *           diimpor oleh worker/worker.js dan tidak mengubah perilaku produksi.
 * Runtime : hanya API web standar (fetch, crypto.subtle, TextEncoder, atob/btoa)
 *           sehingga bisa jalan di Node >= 18 DAN di Cloudflare Workers.
 *
 * Catatan : helper tanda tangan & timestamp di bawah adalah CERMIN PERSIS dari
 *           worker/worker.js supaya varian "baseline" benar-benar mewakili
 *           perilaku produksi saat ini.
 */

export const DANA_HOSTS = {
  sandbox: "https://api.sandbox.dana.id",
  production: "https://api.saas.dana.id"
};

export const CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";

// Nilai yang SAMA PERSIS dengan worker/worker.js (URL, MCC, dan nilai worker sebelum patch).
export const WORKER_DEFAULTS = {
  redirectUrl: "https://customlink.pages.dev/",
  notifyUrl: "https://customlink-webhook.modernshopp.workers.dev/api/webhook/gapura",
  workerOrigin: "https://customlink-webhook.modernshopp.workers.dev",
  registeredOrigin: "https://customlink.pages.dev",
  // Nilai yang dikirim worker.js LAMA sebagai subMerchantId. Ini adalah SHOP ID
  // (dashboard.dana.id/sandbox/submerchants -> tab "Shop"), BUKAN externalDivisionId.
  // Akibatnya DANA membalas 4045408 + debugMessage "DIVISION_NOT_EXIST:division not exist".
  hardcodedSubMerchantId: "216660000003605019003",
  // External Division ID resmi (tab "Division") -> INILAH nilai yang benar untuk subMerchantId.
  externalDivisionId: "d5831d89",
  // External Shop ID (tab "Shop") -> dipakai untuk externalStoreId (opsional).
  externalShopId: "7b7c6a5f",
  // CHANNEL-ID wajib 1-5 karakter; 95221 = nilai pada Sample Payload dashboard DANA.
  channelId: "95221",
  mcc: "5734",
  channelSuffix: "-SERVER"
};

// Referensi kode respons DANA SNAP service code 54 (Gapura Payment Gateway).
// Sumber: DANA API Docs - Create Order (Hosted Checkout) "Response Codes List".
export const RESPONSE_MEANINGS = {
  "2005400": "Successful",
  "4005400": "Bad Request (general)",
  "4005401": "Invalid Field Format",
  "4005402": "Invalid Mandatory Field",
  "4015400": "Unauthorized / Invalid Signature",
  "4035402": "Exceeds Transaction Amount Limit",
  "4035405": "Do Not Honor (user/account abnormal)",
  "4035415": "Transaction Not Permitted",
  "4045408": "Invalid Merchant (merchant tidak ada atau status abnormal)",
  "4045418": "Inconsistent Request (partnerReferenceNo sama, payload berbeda)",
  "4095400": "Conflict (X-EXTERNAL-ID sama di hari yang sama)",
  "4295400": "Too Many Requests",
  "5005400": "General Error",
  "5005401": "Internal Server Error"
};

// --- Helper: normalisasi & konversi kunci (cermin worker.js:79-95) ---
export function normalizePrivateKeyPem(raw) {
  const key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PRIVATE KEY")) return key;
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  return "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----";
}

export function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function sha256Hex(text) {
  const dg = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(dg)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Timestamp (cermin worker.js:56-68) ---
export function snapTimestampUtc(date = new Date()) {
  const d = date;
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "+00:00";
}

// Format yang DIMINTA dokumentasi DANA: YYYY-MM-DDTHH:mm:ss+07:00 (GMT+7, 25 karakter).
export function snapTimestampGmt7(date = new Date()) {
  const t = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate()) +
    "T" + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()) + "+07:00";
}

export function snapValidUpTo(date = new Date()) {
  const t = new Date(date.getTime() + 24 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate()) +
    "T" + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()) + "+07:00";
}

export function randomExternalId() {
  const hex = "0123456789abcdef";
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += hex[b >> 4] + hex[b & 15];
  return "sdk" + s.substring(3, 31);
}

// --- X-SIGNATURE (cermin worker.js:102-114) ---
export async function snapB2BSignature(endpointPath, requestBody, privateKeyPem, timestamp) {
  const hash = await sha256Hex(requestBody);
  const stringToSign = "POST:" + endpointPath + ":" + hash + ":" + timestamp;
  const keyData = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(stringToSign));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// --- Body request (cermin worker.js:155-170) ---
export function buildRequestBody(cfg, opts) {
  const o = opts || {};
  const amount = Number.isFinite(Number(o.amount)) && Number(o.amount) > 0 ? Math.round(Number(o.amount)) : 285000;
  const body = {
    partnerReferenceNo: o.orderId,
    merchantId: cfg.merchantId,
    amount: { value: String(amount) + ".00", currency: "IDR" },
    validUpTo: snapValidUpTo(),
    urlParams: [
      { url: cfg.redirectUrl, type: "PAY_RETURN", isDeeplink: "N" },
      { url: cfg.notifyUrl, type: "NOTIFICATION", isDeeplink: "N" }
    ],
    additionalInfo: {
      mcc: cfg.mcc,
      envInfo: { sourcePlatform: "IPG", terminalType: "SYSTEM" },
      order: {
        orderTitle: ("CustomLink " + String(o.packageName || "Package")).slice(0, 32),
        scenario: "REDIRECT"
      }
    }
  };
  // subMerchantId HARUS = externalDivisionId yang terdaftar di DANA (tab "Division").
  // worker.js:153 (sebelum patch) selalu mengirim SHOP ID hardcoded -> inilah yang diuji di sini.
  const subMerchantValue = o.subMerchantIdValue !== undefined ? o.subMerchantIdValue : cfg.subMerchantId;
  if (o.includeSubMerchantId && subMerchantValue) body.subMerchantId = subMerchantValue;
  // externalStoreId (External Shop ID) bersifat opsional.
  const storeValue = o.externalStoreIdValue !== undefined ? o.externalStoreIdValue : cfg.externalStoreId;
  if (storeValue) body.externalStoreId = storeValue;
  return body;
}

// --- Konfigurasi dari environment (Worker env ATAU process.env) ---
export function readConfig(env) {
  const e = env || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = e[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  return {
    danaEnv: pick("DANA_ENV").toLowerCase() === "production" ? "production" : "sandbox",
    merchantId: pick("MERCHANT_ID"),
    partnerId: pick("CLIENT_ID", "X_PARTNER_ID"),
    privateKeyPem: normalizePrivateKeyPem(pick("DANA_PRIVATE_KEY")),
    subMerchantId: pick("SUB_MERCHANT_ID") || WORKER_DEFAULTS.hardcodedSubMerchantId,
    subMerchantIdIsFallback: !pick("SUB_MERCHANT_ID"),
    divisionId: pick("DANA_DIVISION_ID", "SUB_MERCHANT_ID") || WORKER_DEFAULTS.externalDivisionId,
    externalStoreId: pick("EXTERNAL_STORE_ID", "DANA_STORE_ID"),
    origin: pick("DANA_ORIGIN") || WORKER_DEFAULTS.registeredOrigin,
    originIsFromEnv: Boolean(pick("DANA_ORIGIN")),
    channelId: pick("DANA_CHANNEL_ID") || WORKER_DEFAULTS.channelId,
    mcc: pick("DANA_MCC") || WORKER_DEFAULTS.mcc,
    redirectUrl: WORKER_DEFAULTS.redirectUrl,
    notifyUrl: WORKER_DEFAULTS.notifyUrl,
    workerOrigin: WORKER_DEFAULTS.workerOrigin
  };
}

export function hostFor(cfg) {
  return DANA_HOSTS[cfg.danaEnv] || DANA_HOSTS.sandbox;
}

// --- Definisi varian uji (yang membedakan tiap request satu sama lain) ---
export function buildVariants(cfg) {
  const channelLong = cfg.partnerId + WORKER_DEFAULTS.channelSuffix;
  // Varian "isolasi" di bawah sengaja tetap memakai nilai worker.js LAMA (Shop ID dikirim
  // sebagai subMerchantId) supaya perbedaannya benar-benar hanya SATU variabel.
  const shopIdAsSubMerchant = WORKER_DEFAULTS.hardcodedSubMerchantId;
  return [
    {
      id: "baseline",
      label: "BASELINE - persis seperti worker.js produksi (sebelum patch)",
      reason: "subMerchantId = Shop ID + ORIGIN origin Worker + X-TIMESTAMP UTC + CHANNEL-ID panjang.",
      includeSubMerchantId: true,
      subMerchantIdValue: shopIdAsSubMerchant,
      origin: cfg.workerOrigin,
      timestampMode: "utc",
      channelId: channelLong
    },
    {
      id: "no-submerchant",
      label: "TANPA subMerchantId (hipotesis H3)",
      reason: "Menguji apakah subMerchantId yang tidak terdaftar sebagai division penyebab 4045408.",
      includeSubMerchantId: false,
      origin: cfg.workerOrigin,
      timestampMode: "utc",
      channelId: channelLong
    },
    {
      id: "division-id",
      label: "PERBAIKAN: subMerchantId = EXTERNAL DIVISION ID resmi (H3-fix)",
      reason: "Memakai kolom External Division ID dari tab Division (" + cfg.divisionId + "), bukan Shop ID, " +
        "plus ORIGIN terdaftar + X-TIMESTAMP GMT+7 + CHANNEL-ID 1-5 karakter.",
      includeSubMerchantId: true,
      subMerchantIdValue: cfg.divisionId,
      origin: cfg.origin,
      timestampMode: "gmt7",
      channelId: cfg.channelId
    },
    {
      id: "registered-origin",
      label: "ORIGIN domain terdaftar (hipotesis H4)",
      reason: "Menguji apakah ORIGIN workers.dev yang tidak terdaftar penyebab 4045408.",
      includeSubMerchantId: true,
      subMerchantIdValue: shopIdAsSubMerchant,
      origin: cfg.origin,
      timestampMode: "utc",
      channelId: channelLong
    },
    {
      id: "spec-timestamp",
      label: "X-TIMESTAMP GMT+7 sesuai spec",
      reason: "Docs DANA minta format +07:00, sedangkan worker mengirim +00:00.",
      includeSubMerchantId: true,
      subMerchantIdValue: shopIdAsSubMerchant,
      origin: cfg.workerOrigin,
      timestampMode: "gmt7",
      channelId: channelLong
    },
    {
      id: "short-channel",
      label: "CHANNEL-ID pendek (1-5 karakter)",
      reason: "Spec DANA: CHANNEL-ID 1-5 karakter; worker LAMA mengirim " + channelLong.length + " karakter (" + channelLong + ").",
      includeSubMerchantId: true,
      subMerchantIdValue: shopIdAsSubMerchant,
      origin: cfg.workerOrigin,
      timestampMode: "utc",
      channelId: cfg.channelId
    },
    {
      id: "clean",
      label: "GABUNGAN perbaikan TANPA Division (tanpa subMerchantId + ORIGIN terdaftar + GMT+7 + CHANNEL-ID)",
      reason: "Kandidat konfigurasi bersih bila merchant tidak memakai skema Division.",
      includeSubMerchantId: false,
      origin: cfg.origin,
      timestampMode: "gmt7",
      channelId: cfg.channelId
    }
  ];
}

export function selectVariants(cfg, requested) {
  const all = buildVariants(cfg);
  if (!requested || requested === "all") return all;
  const wanted = String(requested).split(",").map((s) => s.trim()).filter(Boolean);
  return all.filter((v) => wanted.includes(v.id));
}

export function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 12) return "***";
  return s.slice(0, 8) + "..." + s.slice(-4) + " (" + s.length + " char)";
}

// --- Preflight: cek konformitas terhadap spesifikasi DANA (tanpa jaringan) ---
export function preflight(env) {
  const e = env || {};
  const cfg = readConfig(e);
  const checks = [];
  const add = (name, status, expected, actual, hint) => checks.push({ name, status, expected, actual, hint: hint || "" });

  const envRaw = String(e.DANA_ENV || "").trim().toLowerCase();
  add("DANA_ENV", !envRaw ? "warn" : (["sandbox", "production"].includes(envRaw) ? "ok" : "fail"),
    "sandbox | production", envRaw || "(tidak diset -> default sandbox)",
    "Wajib konsisten dengan host kredensial yang dipakai.");

  add("MERCHANT_ID", cfg.merchantId ? "ok" : "fail", "ada (1-64 char)", cfg.merchantId ? cfg.merchantId.length + " char" : "(kosong)",
    "Penyebab utama 4045408: merchant tidak dikenal di environment ini.");

  add("CLIENT_ID / X-PARTNER-ID", cfg.partnerId ? "ok" : "fail", "ada (1-36 char)", cfg.partnerId ? cfg.partnerId.length + " char" : "(kosong)",
    "Harus pasangan dari MERCHANT_ID pada akun DANA yang sama.");

  const chLen = (cfg.partnerId + WORKER_DEFAULTS.channelSuffix).length;
  const channelOk = cfg.channelId.length <= 5;
  add("CHANNEL-ID (worker.js:192)", chLen <= 5 && channelOk ? "ok" : "warn", "1-5 karakter",
    "worker LAMA mengirim " + chLen + " char (partnerId + \"-SERVER\"); nilai varian/setelah patch: " +
    cfg.channelId + " (" + cfg.channelId.length + " char)",
    "Spec DANA: CHANNEL-ID 1-5 karakter. Contoh resmi pada Sample Payload dashboard = 95221.");

  add("X-TIMESTAMP (worker.js lama)", "warn", "YYYY-MM-DDTHH:mm:ss+07:00 (25 char)",
    "worker LAMA mengirim +00:00 (UTC); setelah patch: GMT+7 (+07:00)",
    "Docs DANA: wajib GMT+7. Diuji oleh varian spec-timestamp & division-id.");

  add("ORIGIN", cfg.workerOrigin === cfg.origin ? "ok" : "warn",
    "sama dengan origin terdaftar (" + cfg.origin + ")", "worker LAMA mengirim " + cfg.workerOrigin,
    "Setelah patch, ORIGIN diambil dari env DANA_ORIGIN (worker/wrangler.toml [vars]).");

  add("SUB_MERCHANT_ID", cfg.subMerchantIdIsFallback ? "warn" : "ok",
    "External Division ID resmi (dashboard.dana.id/sandbox/submerchants -> tab Division)",
    cfg.subMerchantIdIsFallback
      ? cfg.subMerchantId + " (FALLBACK HARDCODED = External SHOP ID, bukan Division)"
      : cfg.subMerchantId,
    "Worker LAMA mengirim Shop ID sebagai subMerchantId -> DANA menjawab 4045408 dengan " +
    "debugMessage \"DIVISION_NOT_EXIST:division not exist\". Nilai yang benar contohnya " +
    cfg.divisionId + " (tab Division).");

  add("DANA_PRIVATE_KEY", cfg.privateKeyPem ? "ok" : "fail", "RSA PKCS#8 PEM", cfg.privateKeyPem ? "terbaca" : "(kosong)",
    "Tanpa ini, X-SIGNATURE gagal -> 4015400.");

  const sbKey = e ? e.SUPABASE_SERVICE_ROLE_KEY : "";
  add("SUPABASE_SERVICE_ROLE_KEY", sbKey ? "ok" : "warn", "ada (opsional untuk diagnosa)", sbKey ? "ada" : "(kosong)",
    "Hanya dibutuhkan oleh /api/webhook/gapura, bukan oleh create-payment.");

  const ok = checks.filter((c) => c.status === "fail").length === 0;
  return { ok, danaEnv: cfg.danaEnv, host: hostFor(cfg), checks };
}

// --- Eksekusi satu varian ---
export async function runVariant(env, variant, options) {
  const cfg = readConfig(env);
  const o = options || {};
  const started = Date.now();

  if (variant.skipIfEmpty && !variant.channelId) {
    return { id: variant.id, label: variant.label, skipped: true,
      note: "Dilewati: butuh env " + variant.skipIfEmpty + "." };
  }
  if (!cfg.merchantId || !cfg.partnerId) {
    return { id: variant.id, label: variant.label, skipped: true,
      note: "Dilewati: MERCHANT_ID / CLIENT_ID belum diisi." };
  }
  if (!cfg.privateKeyPem) {
    return { id: variant.id, label: variant.label, skipped: true,
      note: "Dilewati: DANA_PRIVATE_KEY belum diisi (X-SIGNATURE tidak bisa dibuat)." };
  }

  const orderId = "DIAG-" + variant.id.toUpperCase() + "-" + Date.now();
  const bodyObj = buildRequestBody(cfg, {
    orderId,
    amount: o.amount,
    packageName: o.packageName,
    includeSubMerchantId: variant.includeSubMerchantId,
    subMerchantIdValue: variant.subMerchantIdValue,
    externalStoreIdValue: variant.externalStoreIdValue
  });
  const bodyStr = JSON.stringify(bodyObj);
  const timestamp = variant.timestampMode === "gmt7" ? snapTimestampGmt7() : snapTimestampUtc();

  let signature = "";
  try {
    signature = await snapB2BSignature(CREATE_ORDER_PATH, bodyStr, cfg.privateKeyPem, timestamp);
  } catch (err) {
    return { id: variant.id, label: variant.label, error: "Gagal menandatangani request: " + (err && err.message) };
  }

  const headers = {
    "Content-Type": "application/json",
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "ORIGIN": variant.origin,
    "X-PARTNER-ID": cfg.partnerId,
    "X-EXTERNAL-ID": randomExternalId(),
    "CHANNEL-ID": variant.channelId
  };
  if (cfg.danaEnv === "sandbox") headers["X-Debug-Mode"] = "true";

  const endpoint = hostFor(cfg) + CREATE_ORDER_PATH;
  const requestPreview = {
    endpoint: endpoint,
    headers: Object.assign({}, headers, { "X-SIGNATURE": maskSecret(signature) }),
    body: bodyObj
  };

  if (o.dryRun) {
    return { id: variant.id, label: variant.label, dryRun: true, request: requestPreview, durationMs: Date.now() - started };
  }

  const result = { id: variant.id, label: variant.label, request: requestPreview, durationMs: 0 };
  try {
    const res = await fetch(endpoint, { method: "POST", headers: headers, body: bodyStr });
    result.httpStatus = res.status;
    const raw = await res.text();
    result.raw = raw.slice(0, 4000);
    try { result.json = JSON.parse(raw); } catch (e) { result.json = null; }
    const j = result.json || {};
    const d = j.data || {};
    result.responseCode = j.responseCode || d.responseCode || j.statusCode || "";
    result.responseMessage = j.responseMessage || d.responseMessage || j.message || "";
    result.debugMessage = (j.additionalInfo && j.additionalInfo.debugMessage) ||
      (d.additionalInfo && d.additionalInfo.debugMessage) || "";
    result.meaning = RESPONSE_MEANINGS[result.responseCode] || "";
    result.ok = res.ok && String(result.responseCode).indexOf("200") === 0;
  } catch (err) {
    result.networkError = (err && err.message) || String(err);
    result.ok = false;
  }
  result.durationMs = Date.now() - started;
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function publicConfig(cfg) {
  return {
    dana_env: cfg.danaEnv,
    host: hostFor(cfg),
    endpoint: hostFor(cfg) + CREATE_ORDER_PATH,
    merchant_id: maskSecret(cfg.merchantId),
    client_id: maskSecret(cfg.partnerId),
    private_key: cfg.privateKeyPem ? "terbaca (" + cfg.privateKeyPem.length + " char)" : "(kosong)",
    sub_merchant_id: cfg.subMerchantId + (cfg.subMerchantIdIsFallback ? " (fallback hardcoded worker.js:153)" : " (dari env)"),
    external_division_id: cfg.divisionId,
    external_store_id: cfg.externalStoreId || "(tidak dikirim)",
    channel_id: cfg.channelId + " (" + cfg.channelId.length + " char)",
    origin_dipakai_worker: cfg.workerOrigin,
    origin_domain_terdaftar: cfg.origin,
    redirect_url: cfg.redirectUrl,
    notify_url: cfg.notifyUrl
  };
}

// --- Analisa hasil: terjemahkan pola respons menjadi diagnosis ---
export function buildVerdict(results) {
  const run = (results || []).filter((r) => !r.skipped && !r.dryRun);
  const byId = {};
  for (const r of run) byId[r.id] = r;
  const findings = [];
  const nextSteps = [];
  const success = run.filter((r) => r.ok);

  if (run.length === 0) {
    return { indeterminate: true, findings: ["Tidak ada varian yang dieksekusi (kredensial/dukungan env belum lengkap)."], nextSteps: [] };
  }

  const codes = run.map((r) => r.responseCode).filter(Boolean);
  const allMerchantError = codes.length > 0 && codes.every((c) => c === "4045408");
  const anyAuth = codes.some((c) => c === "4015400");
  const anyFormat = codes.some((c) => c === "4005401" || c === "4005402");

  const base = byId["baseline"];
  const noSub = byId["no-submerchant"];
  const divId = byId["division-id"];
  const regOrigin = byId["registered-origin"];
  const specTs = byId["spec-timestamp"];
  const clean = byId["clean"];

  // Deteksi khusus: DANA menyampaikan detail penyebab lewat additionalInfo.debugMessage.
  const anyDivisionNotExist = run.some((r) => String(r.debugMessage || "").indexOf("DIVISION_NOT_EXIST") >= 0);
  const shopIdSentAsSubMerchant = run.some((r) =>
    r.request && r.request.body && r.request.body.subMerchantId === WORKER_DEFAULTS.hardcodedSubMerchantId);

  // Pelanggaran spesifikasi yang terlihat pada baseline (semuanya sudah diperbaiki di worker versi baru).
  if (base && base.request) {
    const body = base.request.body || {};
    const issues = [];
    if (String(base.request.headers["CHANNEL-ID"] || "").length > 5) {
      issues.push("CHANNEL-ID " + String(base.request.headers["CHANNEL-ID"]).length + " karakter (spec: 1-5)");
    }
    if (String(base.request.headers["X-TIMESTAMP"] || "").indexOf("+07:00") < 0) issues.push("X-TIMESTAMP bukan GMT+7");
    if (String(base.request.headers.ORIGIN || "").indexOf(".workers.dev") >= 0) issues.push("ORIGIN memakai origin Worker");
    if (body.subMerchantId === WORKER_DEFAULTS.hardcodedSubMerchantId) {
      issues.push("subMerchantId memakai External SHOP ID, bukan External DIVISION ID");
    }
    if (issues.length) findings.push("Pelanggaran spesifikasi pada baseline: " + issues.join("; ") + ".");
  }

  if (byId["baseline"] && byId["baseline"].networkError) {
    findings.push("Request tidak sampai ke DANA: " + byId["baseline"].networkError +
      " -> cek koneksi DNS/firewall/proxy, bukan masalah merchant.");
  }

  if (success.length > 0) {
    findings.push("BERHASIL pada varian: " + success.map((r) => r.id).join(", ") +
      (success[0].webRedirectUrl ? "" : " (respons sukses diterima)."));
    if (base && !base.ok && noSub && noSub.ok) {
      findings.push("DIAGNOSIS: `subMerchantId` yang dikirim worker.js:153 (" + "fallback hardcoded" + ") TIDAK terdaftar di DANA -> itulah penyebab 4045408 (hipotesis H3 TERBUKTI).");
      nextSteps.push("Hapus/kosongkan subMerchantId dari payload create-payment, ATAU isi SUB_MERCHANT_ID dengan External Division ID resmi dari dashboard.dana.id/sandbox/submerchants.");
    }
    if (base && !base.ok && regOrigin && regOrigin.ok) {
      findings.push("DIAGNOSIS: header ORIGIN yang dipakai worker.js:149 (origin Worker) ditolak DANA -> hipotesis H4 TERBUKTI.");
      nextSteps.push("Ganti ORIGIN agar memakai domain terdaftar (env DANA_ORIGIN) dan hapus pemakaian new URL(request.url).origin pada worker.js:149.");
    }
    if (base && !base.ok && specTs && specTs.ok) {
      findings.push("DIAGNOSIS: format X-TIMESTAMP menentukan; worker.js:56-61 harus memakai GMT+7 (+07:00).");
      nextSteps.push("Ubah snapTimestamp() agar memakai format GMT+7 sesuai dokumentasi DANA.");
    }
    if (base && !base.ok && clean && clean.ok) {
      findings.push("DIAGNOSIS: kombinasi perbaikan (tanpa subMerchantId + ORIGIN terdaftar + timestamp GMT+7) berhasil -> akar masalah ada di header/payload worker, BUKAN di kredensial merchant.");
      nextSteps.push("Terapkan patch pada worker.js:149 (ORIGIN), worker.js:153 (subMerchantId), worker.js:56-61 (timestamp), lalu redeploy.");
    }
    if (divId && divId.ok) {
      findings.push("DIAGNOSIS: subMerchantId yang BENAR = External Division ID (" + WORKER_DEFAULTS.externalDivisionId +
        "), BUKAN " + WORKER_DEFAULTS.hardcodedSubMerchantId + " (itu External SHOP ID) -> hipotesis H3 TERBUKTI.");
      nextSteps.push("Set SUB_MERCHANT_ID = External Division ID pada worker/wrangler.toml ([vars]) atau env Worker, lalu redeploy.");
    }
  }

  if (allMerchantError) {
    findings.push("SEMUA varian gagal dengan 4045408 Invalid Merchant -> masalah BUKAN pada header/payload yang diuji, melainkan pada IDENTITAS/STATUS MERCHANT di environment yang dipanggil.");
    nextSteps.push("Buka dashboard.dana.id (mode Sandbox): pastikan 'company registration' SELESAI dan produk 'Gapura Hosted Checkout' DIPILIH.");
    nextSteps.push("Salin ulang MERCHANT_ID + CLIENT_ID dari dashboard Sandbox (kredensial sandbox BERBEDA dari production) dan samakan dengan wrangler.toml.");
    nextSteps.push("Pastikan private key yang di-upload ke dashboard DANA = pasangan dari secret DANA_PRIVATE_KEY yang dipakai Worker.");
    nextSteps.push("Jika semua sudah benar, kirim tiket ke DANA dengan responseCode 4045408 + X-EXTERNAL-ID + X-TIMESTAMP dari hasil di atas.");
  }

  if (anyDivisionNotExist) {
    findings.push("DANA mengirim debugMessage \"DIVISION_NOT_EXIST\" -> nilai subMerchantId tidak dikenal sebagai " +
      "externalDivisionId yang terdaftar." +
      (shopIdSentAsSubMerchant
        ? " Nilai yang dikirim adalah External SHOP ID (" + WORKER_DEFAULTS.hardcodedSubMerchantId +
          "), padahal field subMerchantId wajib berisi External DIVISION ID."
        : ""));
    nextSteps.push("Buka dashboard.dana.id/sandbox/submerchants -> tab Division, salin nilai kolom External Division ID (contoh: " +
      WORKER_DEFAULTS.externalDivisionId + ").");
    nextSteps.push("Isi SUB_MERCHANT_ID dengan nilai itu (worker/wrangler.toml [vars] SUB_MERCHANT_ID), " +
      "atau kosongkan supaya worker tidak mengirim subMerchantId sama sekali.");
    nextSteps.push("JANGAN memakai kolom External Shop ID / Division ID internal; itu sebab munculnya DIVISION_NOT_EXIST.");
  }

  if (anyAuth) {
    findings.push("Ada respons 4015400 (Invalid Signature) -> X-SIGNATURE/PRIVATE_KEY tidak cocok dengan CLIENT_ID di environment ini.");
    nextSteps.push("Cek pairing private key <-> clientId pada environment tersebut (sandbox vs production).");
  }
  if (anyFormat) {
    findings.push("Ada respons 4005401/4005402 -> ada field wajib/format yang tidak sesuai spesifikasi (lihat daftar preflight).");
  }

  return {
    successIds: success.map((r) => r.id),
    allMerchantError: allMerchantError,
    findings: findings,
    nextSteps: nextSteps
  };
}

// --- Orkestrasi lengkap ---
export async function runDiagnostics(env, options) {
  const o = options || {};
  const cfg = readConfig(env);
  const variants = selectVariants(cfg, o.variant);
  const results = [];
  for (let i = 0; i < variants.length; i++) {
    if (i > 0 && !o.dryRun) await sleep(o.delayMs || 1200);
    results.push(await runVariant(env, variants[i], o));
  }
  return {
    preflight: preflight(env),
    config: publicConfig(cfg),
    dryRun: Boolean(o.dryRun),
    results: results,
    verdict: buildVerdict(results)
  };
}



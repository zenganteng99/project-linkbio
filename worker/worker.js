// customlink-webhook - DANA Payment Gateway (SNAP) + auto-activation klien + Dynamic SEO Engine + Analytics + Edge Cache Engine + Upgrade Engine + Smart Auto-Scraper
// Route:
//   OPTIONS /api/*                  -> CORS preflight
//   GET     /api/public/store       -> Katalog publik ter-cache (Termasuk Pixel Tracking ID & Max Products)
//   POST    /api/create-payment     -> Buat transaksi pembayaran DANA SNAP (Order Baru & Upgrade)
//   POST    /api/webhook/gapura     -> Auto-aktivasi klien & Auto-Upgrade paket setelah pembayaran sukses
//   POST    /api/scrape-product     -> Ekstrak cerdas metadata produk dari link affiliate (Shopee/TikTok/Tokopedia)
//   POST    /api/track              -> Ingestion pelacakan analitik pengunjung & klik (Non-blocking)
//   GET     /api/admin/analytics    -> Penarikan ringkasan data analitik 7 hari untuk admin (Cache 60s)
//   POST    /api/check-voucher      -> Validasi kode voucher & endorse secara aman (Server-Side)
//   POST    /api/register-influencer-> Registrasi akun influencer & klaim endorse aman (Server-Side)
//   GET     /*                      -> Cloudflare Pages Proxy + Dynamic Open Graph & Meta SEO Injection (Cache 300s)

// =============================================================================
// CORS CONFIGURATION - Restricted to authorized origins only
// =============================================================================
const ALLOWED_ORIGINS = [
  'https://customlink.id',
  'https://www.customlink.id',
  'https://customlink.pages.dev'
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || request.headers.get('origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

// =============================================================================

// =============================================================================
// CLOUDFLARE R2 STORAGE - Image Upload/Delete/CDN
// =============================================================================
async function handleUploadImage(request, env) {
  if (!env.ASSETS_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }
  
  try {
    // Parse FormData from request
    const formData = await request.formData();
    const file = formData.get("file");
    const oldUrl = formData.get("oldUrl");
    
    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "File is required" }, 400);
    }
    
    /* DISABLED - Orphan GC will handle cleanup later
    // Delete old file if oldUrl is provided
    if (oldUrl && typeof oldUrl === 'string') {
      const oldPath = extractPathFromUrl(oldUrl);
      if (oldPath) {
        try {
          await env.ASSETS_BUCKET.delete(oldPath);
        } catch (delErr) {
          console.error('Failed to delete old file:', delErr);
        }
      }
    }
    */
    
    // Generate unique filename
    const ext = file.name ? file.name.split(".").pop() : 'jpg';
    const filename = 'assets/' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + ext;
    
    // Get file content and upload to R2
    const arrayBuffer = await file.arrayBuffer();
    const fileContent = new Uint8Array(arrayBuffer);
    
    await env.ASSETS_BUCKET.put(filename, fileContent, {
      httpMetadata: {
        contentType: file.type || "image/jpeg"
      }
    });
    
    // Return public URL
    const primaryDomain = env.PRIMARY_DOMAIN || "https://customlink.pages.dev";
    const publicUrl = primaryDomain + '/cdn/' + filename;
    
    return jsonResponse({ 
      success: true, 
      url: publicUrl,
      filename: filename
    });
    
  } catch (err) {
    console.error('Upload error:', err);
    return jsonResponse({ error: "Upload failed: " + err.message }, 500);
  }
}

async function handleDeleteImage(request, env) {
  if (!env.ASSETS_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }
  try {
    const body = await request.json();
    const url = body.url;
    if (!url) {
      return jsonResponse({ error: "URL is required" }, 400);
    }
    const filePath = extractPathFromUrl(url);
    if (!filePath) {
      return jsonResponse({ error: "Invalid URL format" }, 400);
    }
    await env.ASSETS_BUCKET.delete(filePath);
    return jsonResponse({ success: true, deleted: filePath });
  } catch (err) {
    return jsonResponse({ error: "Delete failed: " + err.message }, 500);
  }
}
async function handleClearCache(request, env) {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug') || url.searchParams.get('clientSlug');
    if (!slug) {
      return jsonResponse({ error: "slug parameter is required" }, 400);
    }
    const cache = caches.default;
    const deletedUrls = [];
    // Clear all possible cached versions across all domains
    const urlsToDelete = [
      `https://customlink.id/api/public/store?slug=${encodeURIComponent(slug)}`,
      `https://customlink.id/${encodeURIComponent(slug)}`,
      `https://customlink-webhook.modernshopp.workers.dev/api/public/store?slug=${encodeURIComponent(slug)}`,
      `https://customlink-webhook.modernshopp.workers.dev/${encodeURIComponent(slug)}`,
      `https://customlink.pages.dev/api/public/store?slug=${encodeURIComponent(slug)}`,
      `https://customlink.pages.dev/${encodeURIComponent(slug)}`
    ];
    for (const u of urlsToDelete) {
      try {
        await cache.delete(new Request(u));
        deletedUrls.push(u);
      } catch(e) {
        console.error("Failed to delete cache for:", u, e);
      }
    }
    return jsonResponse({ success: true, message: "Cache toko dibersihkan", cleared: deletedUrls });
  } catch (err) {
    return jsonResponse({ error: "Cache clear failed: " + err.message }, 500);
  }
}
async function handleCDN(request, env) {
  if (!env.ASSETS_BUCKET) {
    return new Response("R2 bucket not configured", { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.pathname.replace("/cdn/", "");
  if (!key) {
    return new Response("File not found", { status: 404 });
  }
  try {
    const object = await env.ASSETS_BUCKET.get(key);
    if (!object) {
      return new Response("File not found", { status: 404 });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
    return new Response(object.body, { headers });
  } catch (err) {
    return new Response("Error retrieving file", { status: 500 });
  }
}
function extractPathFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/cdn\/(.+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// HELPER FORMATTING ISP & JARINGAN CLOUDFLARE
// =============================================================================
function formatISPName(rawAsOrg) {
  if (!rawAsOrg) return "Lainnya / Seluler";
  const org = rawAsOrg.toLowerCase();
  
  if (org.includes("telekomunikasi selular") || org.includes("telkomsel")) return "Telkomsel (Seluler)";
  if (org.includes("indosat") || org.includes("hutchison") || org.includes("tri")) return "Indosat / Tri (Seluler)";
  if (org.includes("xl axiata") || org.includes("axis")) return "XL Axiata (Seluler)";
  if (org.includes("smartfren")) return "Smartfren (Seluler)";
  if (org.includes("telkom indonesia") || org.includes("indihome")) return "IndiHome (Wi-Fi)";
  if (org.includes("link net") || org.includes("first media") || org.includes("firstmedia")) return "First Media (Wi-Fi)";
  if (org.includes("biznet")) return "Biznet (Wi-Fi)";
  if (org.includes("myrepublic")) return "MyRepublic (Wi-Fi)";
  if (org.includes("cbn")) return "CBN (Wi-Fi)";
  if (org.includes("mora telematika") || org.includes("oxygen")) return "Oxygen.id (Wi-Fi)";
  
  return rawAsOrg.replace(/^(PT\.|PT\s+)/i, "").trim().slice(0, 24);
}

function resolveColoName(coloCode) {
  const code = String(coloCode || "CGK").toUpperCase();
  const coloMap = {
    "CGK": "Jakarta (CGK)",
    "SUB": "Surabaya (SUB)",
    "DPS": "Denpasar (DPS)",
    "BPN": "Balikpapan (BPN)",
    "UPG": "Makassar (UPG)",
    "KNO": "Medan (KNO)",
    "SIN": "Singapura (SIN)",
    "KUL": "Kuala Lumpur (KUL)"
  };
  return coloMap[code] || `${code} Edge Node`;
}

// =============================================================================
// WEBHOOK SECURITY - Signature Verification Helpers
// =============================================================================
/**
 * Normalize public key PEM format for Web Crypto API
 * Accepts both PEM format and raw base64
 */
function normalizePublicKeyPem(raw) {
  const key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PUBLIC KEY")) return key;
  
  // If raw base64, convert to PEM
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  return "-----BEGIN PUBLIC KEY-----\n" + lines.join("\n") + "\n-----END PUBLIC KEY-----";
}

/**
 * Convert PEM to ArrayBuffer for Web Crypto API
 */
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Calculate SHA-256 hash of string, return hex
 */
async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify DANA SNAP signature using Web Crypto API (RSASSA-PKCS1-v1_5 SHA-256)
 * @param {string} endpointUrl - Full webhook URL path (e.g., "/api/webhook/gapura")
 * @param {string} rawBody - Raw request body string
 * @param {string} signatureB64 - Base64 encoded signature from X-SIGNATURE header
 * @param {string} timestamp - Timestamp from X-TIMESTAMP header
 * @param {string} publicKeyPem - Public key in PEM format
 * @returns {Promise<boolean>} - True if signature is valid
 */
async function verifySnapSignature(endpointUrl, rawBody, signatureB64, timestamp, publicKeyPem) {
  if (!publicKeyPem || !signatureB64 || !timestamp) {
    console.warn("[Webhook] Missing parameters for signature verification");
    return false;
  }
  
  try {
    // Calculate SHA-256 of body
    const bodyHash = await sha256Hex(rawBody);
    
    // Build string to sign: POST:<endpoint>:<bodyHash>:<timestamp>
    const stringToSign = "POST:" + endpointUrl + ":" + bodyHash + ":" + timestamp;
    
    // Import public key
    const keyData = pemToArrayBuffer(publicKeyPem);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    
    // Decode signature from base64
    const signatureBinary = atob(signatureB64);
    const signatureBytes = new Uint8Array(signatureBinary.length);
    for (let i = 0; i < signatureBinary.length; i++) {
      signatureBytes[i] = signatureBinary.charCodeAt(i);
    }
    
    // Verify signature
    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBytes,
      new TextEncoder().encode(stringToSign)
    );
    
    return isValid;
  } catch (err) {
    console.error("[Webhook] Signature verification error:", err && err.message);
    return false;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://customlink.id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const DANA_HOSTS = {
  sandbox: "https://api.sandbox.dana.id",
  production: "https://api.saas.dana.id"
};
const DANA_CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";

const PRIMARY_DOMAIN = "https://customlink.id";
const REDIRECT_URL = "https://customlink.id/";
const NOTIFY_URL = "https://customlink-webhook.modernshopp.workers.dev/api/webhook/gapura";
const PAGES_ORIGIN = "https://customlink.pages.dev";
const DEFAULT_CHANNEL_ID = "95221";

// Supabase Connection & Fallback Keys
const SUPABASE_URL = "https://aonbjbcytrpjaxuhyucq.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "";
const DEFAULT_SUPABASE_SERVICE_KEY = "";

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders }
  });
}

function extractPaymentUrl(data) {
  if (!data || typeof data !== "object") return null;
  const d = data.data || {};
  const cands = [data.webRedirectUrl, d.webRedirectUrl, d.paymentUrl, data.paymentUrl, d.url];
  for (const c of cands) {
    if (typeof c === "string" && c.trim() && c.trim() !== "#") return c.trim();
  }
  return null;
}

function extractGatewayMessage(data) {
  if (!data || typeof data !== "object") return null;
  const d = data.data || {};
  const msg = data.responseMessage || d.responseMessage || data.message || data.statusMessage;
  const code = data.responseCode || d.responseCode || data.statusCode;
  if (code && msg) return "[" + code + "] " + msg;
  if (msg) return String(msg);
  if (code) return "kode " + code;
  return null;
}

// --- SNAP Helpers ---
function snapTimestamp() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "+07:00";
}

function snapValidUpTo() {
  const t = new Date(Date.now() + 24 * 60 * 60 * 1000 + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate()) +
    "T" + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()) + "+07:00";
}

function randomExternalId() {
  const hex = "0123456789abcdef";
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += hex[b >> 4] + hex[b & 15];
  return "sdk" + s.substring(3, 31);
}

function resolveChannelId(env) {
  const raw = String((env && env.DANA_CHANNEL_ID) || "").trim();
  if (raw && raw.length <= 5) return raw;
  if (raw) console.warn("[DANA] DANA_CHANNEL_ID diabaikan: " + raw.length + " karakter (wajib 1-5).");
  return DEFAULT_CHANNEL_ID;
}

function normalizePrivateKeyPem(raw) {
  const key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PRIVATE KEY")) return key;
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  return "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----";
}

async function snapB2BSignature(endpointUrl, requestBody, privateKeyPem, timestamp) {
  const hash = await sha256Hex(requestBody);
  const stringToSign = "POST:" + endpointUrl + ":" + hash + ":" + timestamp;
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

// --- Handler: POST /api/create-payment (Mendukung Order Baru & Upgrade) ---
async function handleCreatePayment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, message: "Payload JSON tidak valid." }, 400);
  }

  const buyerName = String(body.buyerName || "").trim();
  const buyerPhone = String(body.buyerPhone || "").trim();
  const packageName = String(body.packageName || "").trim();
  const amount = Number(body.amount);
  const isUpgrade = Boolean(body.isUpgrade);
  const clientSlug = String(body.clientSlug || "").trim().toLowerCase();
  const targetMaxProducts = Number(body.targetMaxProducts || (packageName.toLowerCase().includes("ultimate") ? 50 : 30));

  if (!buyerName || !buyerPhone || !packageName || !Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({
      success: false,
      message: "Payload tidak lengkap: buyerName, buyerPhone, packageName, dan amount (>0) wajib diisi."
    }, 400);
  }

  if (isUpgrade && !clientSlug) {
    return jsonResponse({ success: false, message: "Client Slug wajib disertakan untuk upgrade paket." }, 400);
  }

  const partnerId = String(env.CLIENT_ID || "").trim();
  const merchantId = String(env.MERCHANT_ID || "").trim();
  const privateKeyPem = normalizePrivateKeyPem(env.DANA_PRIVATE_KEY);
  if (!partnerId || !merchantId || !privateKeyPem) {
    return jsonResponse({
      success: false,
      message: "Konfigurasi gateway pembayaran DANA di server belum lengkap. Hubungi admin."
    }, 500);
  }

  const danaEnv = String(env.DANA_ENV || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
  const danaBaseUrl = DANA_HOSTS[danaEnv];
  const origin = String(env.DANA_ORIGIN || PRIMARY_DOMAIN).trim().replace(/\/+$/, "") || PRIMARY_DOMAIN;

  const orderId = isUpgrade
    ? ("UPG-" + clientSlug.slice(0, 15) + "-" + Date.now().toString().slice(-8))
    : ("ORDER-" + Date.now());

  const returnUrl = isUpgrade
    ? `${PRIMARY_DOMAIN}/admin.html?slug=${encodeURIComponent(clientSlug)}&upgrade_success=1`
    : REDIRECT_URL;

  const orderTitle = (isUpgrade ? ('Upgrade ' + packageName) : ('CustomLink ' + packageName)).slice(0, 32);
  const amountStr = String(Math.round(amount)) + ".00";
  const subMerchantId = String(env.SUB_MERCHANT_ID || "").trim();
  const externalStoreId = String(env.EXTERNAL_STORE_ID || "").trim();

  const danaBody = {
    partnerReferenceNo: orderId,
    merchantId: merchantId,
    amount: { value: amountStr, currency: "IDR" },
    validUpTo: snapValidUpTo(),
    urlParams: [
      { url: returnUrl, type: "PAY_RETURN", isDeeplink: "N" },
      { url: NOTIFY_URL, type: "NOTIFICATION", isDeeplink: "N" }
    ],
    additionalInfo: { 
      mcc: '5734', 
      envInfo: { sourcePlatform: 'IPG', terminalType: 'SYSTEM' }, 
      order: { orderTitle: orderTitle, scenario: 'REDIRECT' },
      isUpgrade: isUpgrade,
      clientSlug: clientSlug,
      targetMaxProducts: targetMaxProducts,
      packageName: packageName
    }
  };
  if (subMerchantId) danaBody.subMerchantId = subMerchantId;
  if (externalStoreId) danaBody.externalStoreId = externalStoreId;

  const requestBodyStr = JSON.stringify(danaBody);
  const timestamp = snapTimestamp();
  const externalId = randomExternalId();

  let signature;
  try {
    signature = await snapB2BSignature(DANA_CREATE_ORDER_PATH, requestBodyStr, privateKeyPem, timestamp);
  } catch (signErr) {
    return jsonResponse({
      success: false,
      message: "Gagal menandatangani permintaan ke DANA. Hubungi admin."
    }, 500);
  }

  const snapHeaders = {
    "Content-Type": "application/json",
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "ORIGIN": origin,
    "X-PARTNER-ID": partnerId,
    "X-EXTERNAL-ID": externalId,
    "CHANNEL-ID": resolveChannelId(env),
  };
  if (danaEnv === "sandbox") snapHeaders["X-Debug-Mode"] = "true";

  let gatewayResponse;
  try {
    gatewayResponse = await fetch(danaBaseUrl + DANA_CREATE_ORDER_PATH, {
      method: "POST",
      headers: snapHeaders,
      body: requestBodyStr
    });
  } catch (networkErr) {
    return jsonResponse({
      success: false,
      message: "Tidak dapat menghubungi API gateway pembayaran DANA.",
      detail: { orderId: orderId, stage: "network" }
    }, 504);
  }

  let rawText = await gatewayResponse.text();
  let gatewayData = null;
  try { gatewayData = rawText ? JSON.parse(rawText) : null; } catch (e) {}

  if (!gatewayResponse.ok) {
    const gwMsg = extractGatewayMessage(gatewayData);
    const gwCode = gatewayData && (gatewayData.responseCode || (gatewayData.data && gatewayData.data.responseCode));
    const gwDebug = gatewayData && gatewayData.additionalInfo && gatewayData.additionalInfo.debugMessage;
    const rejectStatus = gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? gatewayResponse.status : 502;
    return jsonResponse({
      success: false,
      orderId: orderId,
      responseCode: gwCode || null,
      debugMessage: gwDebug || null,
      message: "API gateway pembayaran DANA menolak permintaan (HTTP " + gatewayResponse.status + (gwMsg ? " - " + gwMsg : "") + ").",
      detail: gatewayData
    }, rejectStatus);
  }

  const paymentUrl = extractPaymentUrl(gatewayData);
  if (!paymentUrl) {
    const gwMsg = extractGatewayMessage(gatewayData);
    const gwCode = gatewayData && (gatewayData.responseCode || (gatewayData.data && gatewayData.data.responseCode));
    const gwDebug = gatewayData && gatewayData.additionalInfo && gatewayData.additionalInfo.debugMessage;
    return jsonResponse({
      success: false,
      orderId: orderId,
      responseCode: gwCode || null,
      debugMessage: gwDebug || null,
      message: "API gateway pembayaran DANA tidak mengembalikan URL pembayaran." + (gwMsg ? " (" + gwMsg : "") + ")",
      detail: gatewayData
    }, 502);
  }

  return jsonResponse({ success: true, orderId: orderId, paymentUrl: paymentUrl, danaResponse: gatewayData }, 200);
}

// --- Handler: POST /api/webhook/gapura (Mendukung Aktivasi & Upgrade Otomatis) ---
function generateSlug(name, orderId) {
  const base = String(name || "client").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return base + "-" + String(orderId || Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8);
}

async function handleGapuraWebhook(request, env) {
  // =============================================================================
  // WEBHOOK SECURITY - Read raw body first for signature verification
  // =============================================================================
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (e) {
    return jsonResponse({ status: "INVALID", message: "Failed to read request body." }, 400);
  }
  
  if (!rawBody || !rawBody.trim()) {
    return jsonResponse({ status: "INVALID", message: "Empty request body." }, 400);
  }
  
  // Parse payload AFTER reading raw body
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return jsonResponse({ status: "INVALID", message: "Payload webhook tidak valid." }, 400);
  }
  
  // =============================================================================
  // SIGNATURE VERIFICATION - Validate X-SIGNATURE and X-TIMESTAMP headers
  // =============================================================================
  const signature = request.headers.get('X-SIGNATURE');
  const timestamp = request.headers.get('X-TIMESTAMP');
  
  if (env.DANA_PUBLIC_KEY) {
    if (!signature || !timestamp) {
      console.error("[Webhook] Missing signature headers. IP:", request.headers.get('CF-Connecting-IP'));
      return jsonResponse({ status: "INVALID", message: "Missing X-SIGNATURE or X-TIMESTAMP header." }, 400);
    }
    
    const publicKeyPem = normalizePublicKeyPem(env.DANA_PUBLIC_KEY);
    if (!publicKeyPem) {
      console.error("[Webhook] Invalid DANA_PUBLIC_KEY configuration");
      return jsonResponse({ status: "ERROR", message: "Server configuration error." }, 500);
    }
    
    const isValid = await verifySnapSignature(
      "/api/webhook/gapura",
      rawBody,
      signature,
      timestamp,
      publicKeyPem
    );
    
    if (!isValid) {
      console.error("[Webhook] Invalid webhook signature. IP:", request.headers.get('CF-Connecting-IP'));
      return jsonResponse({ status: "INVALID", message: "Invalid webhook signature." }, 401);
    }
    
    console.log("[Webhook] Signature verified successfully for order:", payload.partnerReferenceNo);
  } else {
    console.warn("[Webhook] DANA_PUBLIC_KEY not configured, skipping signature verification (DEVELOPMENT MODE)");
  }
  
  // =============================================================================
  // PAYMENT STATUS VALIDATION - Only process successful payments
  // =============================================================================
  const responseCode = payload.responseCode || payload.responseHeader?.responseCode;
  
  if (responseCode !== '2005400') {
    console.log("[Webhook] Non-success payment ignored. ResponseCode:", responseCode, "Order:", payload.partnerReferenceNo);
    return jsonResponse({ status: "IGNORED", message: "Payment not successful, ignored.", responseCode }, 200);
  }

  const orderId = payload.orderId || payload.originalPartnerReferenceNo || payload.partnerReferenceNo || payload.originalReferenceNo;
  const addInfo = payload.additionalInfo || {};
  const customerName = payload.customerName || payload.buyerName || addInfo.buyerName || "Client";
  const customerPhone = payload.customerPhone || payload.buyerPhone || addInfo.buyerPhone || "";
  const packageName = payload.packageName || addInfo.packageName || "Starter";

  if (!orderId) {
    return jsonResponse({ status: "INVALID", message: "orderId tidak ditemukan di payload webhook." }, 400);
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    return jsonResponse({ status: "ERROR", message: "Konfigurasi Supabase belum lengkap." }, 500);
  }
  
  // =============================================================================
  // IDEMPOTENCY CHECK - Query Supabase to prevent duplicate processing
  // =============================================================================
  try {
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?order_id=eq.${encodeURIComponent(orderId)}&select=id,slug`, {
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey
      }
    });
    
    if (checkRes.ok) {
      const existingClients = await checkRes.json();
      if (existingClients && existingClients.length > 0) {
        console.log("[Webhook] Order already processed (idempotency). OrderId:", orderId);
        return jsonResponse({ 
          status: "OK", 
          message: "Order already processed.", 
          slug: existingClients[0].slug || "existing",
          idempotent: true 
        }, 200);
      }
    }
  } catch (idempErr) {
    console.error("[Webhook] Idempotency check failed:", idempErr && idempErr.message);
  }

  const isUpgrade = String(orderId).startsWith("UPG-") || Boolean(addInfo.isUpgrade);

  // 1. TRANSAKSI UPGRADE PAKET
  if (isUpgrade) {
    let clientSlug = addInfo.clientSlug;
    if (!clientSlug && String(orderId).startsWith("UPG-")) {
      const parts = orderId.split("-");
      if (parts.length >= 3) {
        clientSlug = parts[1];
      }
    }
    clientSlug = (clientSlug || "default").trim().toLowerCase();

    let targetMax = Number(addInfo.targetMaxProducts);
    if (!targetMax) {
      targetMax = packageName.toLowerCase().includes("ultimate") ? 50 : 30;
    }

    const amountVal = Number(payload.amount?.value || addInfo.amount || 0);

    try {
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_package_upgrade`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": "Bearer " + serviceKey
        },
        body: JSON.stringify({
          p_order_id: orderId,
          p_client_slug: clientSlug,
          p_target_package: packageName,
          p_target_max: targetMax,
          p_amount: amountVal
        })
      });

      if (!rpcRes.ok) {
        const errTxt = await rpcRes.text();
        return jsonResponse({ status: "ERROR", message: "Gagal memproses upgrade di Supabase: " + errTxt }, 502);
      }

      // Hapus Edge Cache katalog untuk toko ini
      try {
        const cache = caches.default;
        const cacheUrl = new URL(PRIMARY_DOMAIN + "/api/public/store?slug=" + encodeURIComponent(clientSlug));
        await cache.delete(new Request(cacheUrl.toString()));
      } catch (cErr) {}

      return jsonResponse({ status: "OK", message: "Upgrade paket berhasil diproses", client_slug: clientSlug, max_products: targetMax }, 200);
    } catch (uErr) {
      return jsonResponse({ status: "ERROR", message: "Kesalahan server saat memproses upgrade: " + (uErr && uErr.message) }, 500);
    }
  }

  // 2. PENDAFTARAN KLIEN BARU
  const clientSlug = generateSlug(customerName, orderId);
  const defaultPin = "123456";
  
  // Tentukan max_products berdasarkan nama paket yang dibeli
  let targetMaxProducts = 10; // Default Starter
  if (packageName.toLowerCase().includes("pro")) targetMaxProducts = 30;
  if (packageName.toLowerCase().includes("ultimate")) targetMaxProducts = 50;

  try {
    // A. Insert ke tabel clients
    const clientRes = await fetch(SUPABASE_URL + "/rest/v1/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": "Bearer " + serviceKey,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        order_id: orderId,
        name: customerName,
        phone: customerPhone,
        package: packageName,
        slug: clientSlug,
        status: "active"
      })
    });

    if (!clientRes.ok) {
      return jsonResponse({ status: "ERROR", message: "Gagal menyimpan data klien." }, 502);
    }

    // B. Insert ke tabel settings dengan max_products yang tepat
    await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_slug: clientSlug,
        admin_pin: defaultPin,
        profile_name: customerName,
        max_products: targetMaxProducts
      })
    }).catch(e => console.error("[Webhook] Gagal create settings:", e));

    return jsonResponse({ status: "OK", message: "Akun berhasil diaktifkan secara otomatis", slug: clientSlug, max_products: targetMaxProducts }, 200);
  } catch (err) {
    return jsonResponse({ status: "ERROR", message: "Kesalahan internal webhook: " + (err && err.message) }, 500);
  }
}

// --- Helper Auto-Scraper: Pembersih Teks & Pengurai Slug URL Cerdas ---
function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

function extractTitleFromUrlSlug(urlStr) {
  if (!urlStr) return "";
  try {
    const u = new URL(urlStr);
    // Abaikan domain shortlink agar kode acak TIDAK PERNAH dijadikan judul
    if (u.hostname.includes("s.shopee.co.id") || u.hostname.includes("vt.tiktok.com") || u.hostname.includes("tokopedia.link")) {
      return "";
    }
    const segments = u.pathname.split("/").filter(Boolean);
    for (const seg of segments) {
      if (seg.includes("-i.")) {
        let clean = seg.split("-i.")[0];
        clean = decodeURIComponent(clean).replace(/-/g, " ").replace(/\s+/g, " ").trim();
        if (clean.length > 3) return clean;
      }
      // Hanya terima segmen yang memiliki tanda hubung (-) dan bukan ID tunggal
      if (seg.includes("-") && seg.length > 8 && !['universal-link', 'product', 'share', 'item'].includes(seg.toLowerCase())) {
        let clean = decodeURIComponent(seg).replace(/-/g, " ").replace(/\s+/g, " ").trim();
        if (!/^[a-zA-Z0-9]+$/.test(seg) && clean.length > 6) {
          return clean;
        }
      }
    }
  } catch (e) {}
  return "";
}

// --- Handler: POST /api/scrape-product (Smart Multi-Layer Resolver) ---
async function handleScrapeProduct(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, message: "Payload JSON tidak valid." }, 400);
  }

  let targetUrl = String(body.url || "").trim();
  if (!targetUrl) {
    return jsonResponse({ success: false, message: "URL produk tidak boleh kosong." }, 400);
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = "https://" + targetUrl;
  }

  try {
    const headersList = {
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache"
    };

    let response = await fetch(targetUrl, {
      headers: headersList,
      redirect: "follow"
    });

    let finalUrl = response.url || targetUrl;
    let html = await response.text();

    // Jika shortlink mengarah ke universal-link, cari link produk asli di dalamnya
    const redirMatch = html.match(/(?:redir|target|destination)=([a-zA-Z0-9%_\-\.\/\:\?\=\&]+)/i);
    if (redirMatch && redirMatch[1]) {
      try {
        const decodedRedir = decodeURIComponent(redirMatch[1]);
        if (/^https?:\/\//i.test(decodedRedir) && !decodedRedir.includes("s.shopee.co.id")) {
          finalUrl = decodedRedir;
          const secondResp = await fetch(decodedRedir, { headers: headersList, redirect: "follow" });
          if (secondResp.ok) {
            html = await secondResp.text();
          }
        }
      } catch (e) {}
    }

    // 1. Ekstrak Judul Produk dari Meta Tags
    let title = "";
    const ogTitleMatch = html.match(/<meta[^>]+property=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:title|twitter:title)["']/i) ||
                         html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (ogTitleMatch) {
      title = ogTitleMatch[1];
    }

    // 2. Ekstrak Foto Produk
    let imageUrl = "";
    const ogImageMatch = html.match(/<meta[^>]+property=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|twitter:image|og:image:secure_url)["']/i);
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1].trim();
    }

    // 3. Ekstrak Harga Produk
    let price = "";
    const ogPriceMatch = html.match(/<meta[^>]+property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:price:amount|product:price:amount)["']/i);
    if (ogPriceMatch) {
      price = ogPriceMatch[1].replace(/[^\d]/g, "");
    }

    // 4. Cadangan: JSON-LD Structured Data
    if (!title || !imageUrl || !price) {
      const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch) {
        try {
          const ld = JSON.parse(jsonLdMatch[1]);
          if (!title && ld.name) title = ld.name;
          if (!imageUrl && ld.image) {
            imageUrl = Array.isArray(ld.image) ? ld.image[0] : (typeof ld.image === 'object' ? ld.image.url : ld.image);
          }
          if (!price && ld.offers) {
            const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
            if (offer && offer.price) price = String(offer.price).replace(/[^\d]/g, "");
          }
        } catch (e) {}
      }
    }

    // 5. Cadangan: URL Slug Resolver
    if (!title) {
      title = extractTitleFromUrlSlug(finalUrl);
    }

    // 6. Cadangan: Deteksi Gambar CDN Shopee/TikTok
    if (!imageUrl) {
      const cdnMatch = html.match(/https:\/\/(?:down-id\.img\.susercontent\.com|cf\.shopee\.co\.id\/file|p16-va\.tiktokcdn\.com)\/[a-zA-Z0-9_\-\.\/]+/i);
      if (cdnMatch) {
        imageUrl = cdnMatch[0].replace(/["'>].*$/, "");
      }
    }

    // 7. Cadangan: Regex Deteksi Format Rupiah
    if (!price) {
      const rpMatch = html.match(/Rp\s*([\d\.,]+)/i);
      if (rpMatch) {
        price = rpMatch[1].replace(/[^\d]/g, "");
      }
    }

    // Pembersihan Judul
    if (title) {
      title = decodeHtmlEntities(title)
        .replace(/\s*\|\s*(Shopee|Tokopedia|TikTok Shop|TikTok|Lazada).*/gi, "")
        .replace(/Jual\s+/i, "")
        .trim();
    }

    // Validasi Anti-Hash: Batalkan judul jika hanya berupa kode unik acak
    if (title && (title === "qjypxEMyj" || /^[a-zA-Z0-9]{7,15}$/.test(title))) {
      title = "";
    }

    if (title || imageUrl) {
      return jsonResponse({
        success: true,
        data: {
          title: title ? title.slice(0, 150) : "",
          imageUrl: imageUrl || "",
          price: price || ""
        }
      }, 200);
    }

    return jsonResponse({
      success: false,
      message: "Marketplace memproteksi link pendek ini dari bot. Silakan ketik nama dan upload foto secara manual."
    }, 422);

  } catch (err) {
    return jsonResponse({
      success: false,
      message: "Gagal memproses link produk: " + (err && err.message)
    }, 500);
  }
}

// --- Handler: POST /api/track (Analytics Ingestion via Cloudflare D1 Serverless SQL) ---
async function handleTrack(request, env, ctx) {
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview/i.test(ua)) return new Response(null, { status: 204 });
  
  try {
    const body = await request.json();
    const clientSlug = (body.clientSlug || body.slug || 'default').trim();
    const eventType = body.eventType || 'view';
    const targetId = String(body.targetId || '').trim();
    const cfDevice = (request.headers.get('cf-device-type') || 'desktop').toLowerCase();
    const deviceType = (cfDevice === 'mobile' || cfDevice === 'tablet') ? 'mobile' : 'desktop';
    let rawRef = (body.referrer || 'direct').toLowerCase();
    let referrer = 'direct';
    if (rawRef.includes('instagram.com')) referrer = 'instagram';
    else if (rawRef.includes('tiktok.com')) referrer = 'tiktok';
    else if (rawRef.includes('google.')) referrer = 'google';
    else if (rawRef.includes('facebook.com')) referrer = 'facebook';
    else if (rawRef !== 'direct' && rawRef !== '') referrer = 'other';
    const country = request.cf?.country || request.headers.get('cf-ipcountry') || 'ID';
    const city = request.cf?.city || request.headers.get('cf-ipcity') || 'Indonesia';
    
    // D1 SQL Queries dengan UPSERT pattern
    const dateStr = new Date().toISOString().split('T')[0];
    const queries = [];
    
    if (eventType === 'view') {
        queries.push(env.DB.prepare(`INSERT INTO analytics_daily (client_slug, date_str, views) VALUES (?, ?, 1) ON CONFLICT(client_slug, date_str) DO UPDATE SET views = views + 1`).bind(clientSlug, dateStr));
        queries.push(env.DB.prepare(`INSERT INTO analytics_devices (client_slug, device_type, views) VALUES (?, ?, 1) ON CONFLICT(client_slug, device_type) DO UPDATE SET views = views + 1`).bind(clientSlug, deviceType));
        queries.push(env.DB.prepare(`INSERT INTO analytics_referrers (client_slug, referrer, views) VALUES (?, ?, 1) ON CONFLICT(client_slug, referrer) DO UPDATE SET views = views + 1`).bind(clientSlug, referrer));
        queries.push(env.DB.prepare(`INSERT INTO analytics_locations (client_slug, country, city, views) VALUES (?, ?, ?, 1) ON CONFLICT(client_slug, country, city) DO UPDATE SET views = views + 1`).bind(clientSlug, country, city));
    } else if (eventType === 'product_click') {
        queries.push(env.DB.prepare(`INSERT INTO analytics_daily (client_slug, date_str, product_clicks) VALUES (?, ?, 1) ON CONFLICT(client_slug, date_str) DO UPDATE SET product_clicks = product_clicks + 1`).bind(clientSlug, dateStr));
        queries.push(env.DB.prepare(`INSERT INTO analytics_products (client_slug, product_target, clicks) VALUES (?, ?, 1) ON CONFLICT(client_slug, product_target) DO UPDATE SET clicks = clicks + 1`).bind(clientSlug, targetId));
    } else if (eventType === 'social_click') {
        queries.push(env.DB.prepare(`INSERT INTO analytics_daily (client_slug, date_str, social_clicks) VALUES (?, ?, 1) ON CONFLICT(client_slug, date_str) DO UPDATE SET social_clicks = social_clicks + 1`).bind(clientSlug, dateStr));
    }
    
    const dbTask = env.DB.batch(queries).catch(err => console.error('[D1 Error]', err));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(dbTask); else await dbTask;
    
    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Invalid Payload' }, 400);
  }
}

// --- Handler: GET /api/admin/analytics (Edge Cached 60 Detik + Cloudflare D1 Query) ---
async function handleAdminAnalytics(request, env, ctx) {
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;
  
  const clientSlug = (cacheUrl.searchParams.get('clientSlug') || cacheUrl.searchParams.get('slug') || 'default').trim();
  
  try {
    // Tarik data dari D1
    const { results: trendsData } = await env.DB.prepare(`SELECT date_str, views, product_clicks as clicks, social_clicks FROM analytics_daily WHERE client_slug = ? ORDER BY date_str DESC LIMIT 7`).bind(clientSlug).all();
    let totalViews = 0, totalClicks = 0, totalSocials = 0;
    trendsData.forEach(r => { totalViews += r.views; totalClicks += r.clicks; totalSocials += r.social_clicks; });
    const ctr = totalViews > 0 ? Math.round((totalClicks / totalViews) * 100) : 0;
    
    const { results: topProducts } = await env.DB.prepare(`SELECT product_target as title, clicks as total_clicks FROM analytics_products WHERE client_slug = ? ORDER BY clicks DESC LIMIT 5`).bind(clientSlug).all();
    const { results: devicesData } = await env.DB.prepare(`SELECT device_type, views FROM analytics_devices WHERE client_slug = ?`).bind(clientSlug).all();
    const devices = { mobile: 0, desktop: 0 };
    devicesData.forEach(d => devices[d.device_type] = d.views);
    
    const { results: referrersData } = await env.DB.prepare(`SELECT referrer, views FROM analytics_referrers WHERE client_slug = ? ORDER BY views DESC`).bind(clientSlug).all();
    const referrers = {};
    referrersData.forEach(r => referrers[r.referrer] = r.views);
    
    const { results: locationsData } = await env.DB.prepare(`SELECT country, city, views as total FROM analytics_locations WHERE client_slug = ? ORDER BY views DESC LIMIT 5`).bind(clientSlug).all();

    const payload = {
      summary: { views: totalViews, product_clicks: totalClicks, social_clicks: totalSocials, ctr: ctr },
      trends: trendsData.reverse(),
      top_products: topProducts,
      devices: devices,
      referrers: referrers,
      locations: locationsData
    };

    const response = jsonResponse(payload, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return jsonResponse({ error: 'Kesalahan D1 analitik: ' + err.message }, 500);
  }
}


// --- Handler: GET /api/public/store (Edge Cached 300 Detik / 5 Menit - Termasuk Pixel ID & Max Products & Edge Telemetry) ---
async function handlePublicStore(request, env, ctx) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") || "default").trim();
  const isNoCache = url.searchParams.get("nocache") === "1";

  const cacheKey = new Request(url.origin + "/api/public/store?slug=" + encodeURIComponent(slug));
  const cache = caches.default;

  if (!isNoCache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
  }

  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_SERVICE_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!sbKey) return jsonResponse({ error: "Supabase key belum terkonfigurasi." }, 500);

  try {
    const [settingsRes, productsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/settings?client_slug=eq.${encodeURIComponent(slug)}&select=client_slug,profile_name,hero_title,hero_subtitle,background_url,profile_image_url,theme_style,instagram_link,instagram_active,tiktok_link,tiktok_active,whatsapp_link,whatsapp_active,fb_pixel_id,tiktok_pixel_id,google_analytics_id,max_products&limit=1`, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      }),
      fetch(`${SUPABASE_URL}/rest/v1/products?client_slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=id,title,price,image_url,affiliate_link,sort_order,is_active&order=sort_order.asc`, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      })
    ]);

    const settingsData = await settingsRes.json();
    const productsData = await productsRes.json();

    const cf = request.cf || {};
    const coloCode = cf.colo || "CGK";

    const payload = {
      settings: settingsData && settingsData.length > 0 ? settingsData[0] : null,
      products: Array.isArray(productsData) ? productsData : [],
      edgeInfo: {
        colo: coloCode,
        coloName: resolveColoName(coloCode),
        protocol: cf.httpProtocol || "HTTP/3",
        region: cf.region || cf.regionCode || "ID",
        cacheTimestamp: Date.now() // For client-side image cache busting
      }
    };
    const cacheHeader = isNoCache 
      ? "no-store, no-cache, must-revalidate" 
      : "public, max-age=0, s-maxage=300, must-revalidate";
    const response = jsonResponse(payload, 200, {
      "Cache-Control": cacheHeader,
      "CF-Cache-Status": isNoCache ? "BYPASS" : "MISS"
    });
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch (err) {
    return jsonResponse({ error: "Gagal mengambil katalog dari server." }, 500);
  }
}

// --- Handler: POST /api/check-voucher ---
async function handleCheckVoucher(request, env) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!serviceKey) return jsonResponse({ valid: false, message: "Kredensial server belum lengkap." }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ valid: false, message: "Payload tidak valid." }, 400); }
  const code = String(body.code || "").trim().toLowerCase();
  if (!code) return jsonResponse({ valid: false, message: "Kode voucher kosong." }, 400);

  try {
    const endorseRes = await fetch(`${SUPABASE_URL}/rest/v1/endorse_vouchers?endorse_code=ilike.${encodeURIComponent(code)}&select=*`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const endorseList = await endorseRes.json();
    if (endorseList && endorseList.length > 0) {
      const v = endorseList[0];
      if (v.is_used) {
        return jsonResponse({ valid: false, message: "â Œ Voucher endorse ini sudah pernah digunakan!" });
      }
      return jsonResponse({ valid: true, type: "endorse", discount_percent: 100, code: v.endorse_code });
    }

    const infRes = await fetch(`${SUPABASE_URL}/rest/v1/influencers?voucher_code=ilike.${encodeURIComponent(code)}&select=discount_percent`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const infList = await infRes.json();
    if (infList && infList.length > 0) {
      return jsonResponse({ valid: true, type: "influencer", discount_percent: infList[0].discount_percent || 30 });
    }

    return jsonResponse({ valid: false, message: "â Œ Kode voucher tidak ditemukan. Diskon 0%." });
  } catch (err) {
    return jsonResponse({ valid: false, message: "Gagal memverifikasi voucher di server." }, 500);
  }
}

// --- Handler: POST /api/register-influencer ---
async function handleRegisterInfluencer(request, env) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!serviceKey) return jsonResponse({ success: false, message: "Kredensial server belum lengkap." }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return jsonResponse({ success: false, message: "Payload tidak valid." }, 400); }

  const slug = String(body.slug || "").trim().toLowerCase();
  const voucher = String(body.voucher || "").trim().toUpperCase();
  const whatsapp = String(body.whatsapp || "").trim();
  const bankName = String(body.bankName || "").trim();
  const bankAccount = String(body.bankAccount || "").trim();
  const bankHolder = String(body.bankHolder || "").trim();
  const endorseCode = String(body.endorseCode || "").trim().toLowerCase();

  if (!slug || !voucher || !whatsapp || !bankName || !bankAccount || !bankHolder || !endorseCode) {
    return jsonResponse({ success: false, message: "Semua data form wajib diisi." }, 400);
  }

  try {
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/endorse_vouchers?endorse_code=ilike.${encodeURIComponent(endorseCode)}&is_used=eq.false&select=id`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const checkList = await checkRes.json();
    if (!checkList || checkList.length === 0) {
      return jsonResponse({ success: false, message: "Voucher endorse tidak sah atau sudah terpakai." }, 400);
    }

    // --- AUTO-CREATE CLIENT & SETTINGS FOR INFLUENCER ---
    const defaultPin = "123456";
    const defaultPackage = "Pro"; // Influencer otomatis dapat Pro

    // 1. Insert ke tabel clients
    await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_id: "INF-" + slug + "-" + Date.now(),
        name: bankHolder || slug,
        phone: whatsapp,
        package: defaultPackage,
        slug: slug,
        status: "active"
      })
    }).catch(e => console.error("Gagal create client:", e));

    // 2. Insert ke tabel settings (dengan PIN default)
    await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_slug: slug,
        admin_pin: defaultPin,
        profile_name: bankHolder || slug,
        max_products: 30
      })
    }).catch(e => console.error("Gagal create settings:", e));
    // -----------------------------------------------------

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/influencers`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        client_slug: slug,
        voucher_code: voucher,
        discount_percent: 30,
        whatsapp: whatsapp,
        bank_name: bankName,
        bank_account: bankAccount,
        bank_holder: bankHolder
      })
    });
    if (!insRes.ok) {
      return jsonResponse({ success: false, message: "Gagal menyimpan: Client Slug mungkin sudah terpakai." }, 400);
    }

    await fetch(`${SUPABASE_URL}/rest/v1/endorse_vouchers?endorse_code=ilike.${encodeURIComponent(endorseCode)}`, {
      method: "PATCH",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ is_used: true })
    });

    return jsonResponse({ success: true, message: "Aktivasi berhasil!" }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: "Kesalahan server saat memproses registrasi." }, 500);
  }
}

// --- Handler: Dynamic Open Graph & Meta SEO Injection (Edge Cached 300 Detik) ---
async function handlePageRender(request, env, ctx) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const pagesHost = new URL(PAGES_ORIGIN).host;

  if (url.pathname.includes(".") && !url.pathname.endsWith(".html")) {
    return fetch(PAGES_ORIGIN + url.pathname, { headers: { "Host": pagesHost } });
  }

  const slug = segments.length > 0 ? segments[0] : "";
  const isSpecialPath = ["admin", "api"].includes(slug.toLowerCase());

  if (!slug || isSpecialPath) {
    const targetPath = slug === "admin" ? "/admin.html" : url.pathname;
    return fetch(PAGES_ORIGIN + targetPath, { headers: { "Host": pagesHost } });
  }

  const cacheKey = new Request(url.href);
  const cache = caches.default;
  const cachedPage = await cache.match(cacheKey);
  if (cachedPage) return cachedPage;

  const response = await fetch(PAGES_ORIGIN + "/store.html", { headers: { "Host": pagesHost } });

  let seo = {
    title: "Bio Link Katalog",
    description: "Katalog produk resmi dan link diskon eksklusif.",
    image: `${PRIMARY_DOMAIN}/images/default-og.png`,
    url: url.href
  };

  try {
    const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_SERVICE_KEY || DEFAULT_SUPABASE_ANON_KEY;
    if (sbKey) {
      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?client_slug=eq.${encodeURIComponent(slug)}&select=profile_name,hero_title,hero_subtitle,profile_image_url,background_url`,
        { headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` } }
      );

      if (sbRes.ok) {
        const rows = await sbRes.json();
        if (rows && rows.length > 0) {
          const client = rows[0];
          seo.title = client.profile_name ? `${client.profile_name} | Bio Link Katalog` : seo.title;
          seo.description = client.hero_subtitle || client.hero_title || seo.description;
          seo.image = client.profile_image_url || client.background_url || seo.image;
        }
      }
    }
  } catch (err) {
    console.error("Gagal mendapatkan metadata SEO dari Supabase:", err);
  }

  const transformedResponse = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(seo.title); } })
    .on("head", {
      element(e) {
        e.append(`\n  <meta name="description" content="${seo.description}">`, { html: true });
        e.append(`\n  <meta property="og:type" content="website">`, { html: true });
        e.append(`\n  <meta property="og:title" content="${seo.title}">`, { html: true });
        e.append(`\n  <meta property="og:description" content="${seo.description}">`, { html: true });
        e.append(`\n  <meta property="og:image" content="${seo.image}">`, { html: true });
        e.append(`\n  <meta property="og:url" content="${seo.url}">`, { html: true });
        e.append(`\n  <meta name="twitter:card" content="summary_large_image">`, { html: true });
        e.append(`\n  <meta name="twitter:title" content="${seo.title}">`, { html: true });
        e.append(`\n  <meta name="twitter:description" content="${seo.description}">`, { html: true });
        e.append(`\n  <meta name="twitter:image" content="${seo.image}">\n`, { html: true });
      }
    })
    .transform(response);

  const finalResponse = new Response(transformedResponse.body, transformedResponse);
  finalResponse.headers.set("Cache-Control", "public, max-age=0, s-maxage=300, must-revalidate");

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }

  return finalResponse;
}


// --- Handler: POST /api/admin/run-gc (Orphan Garbage Collector) ---
async function handleGarbageCollector(env) {
  if (!env.ASSETS_BUCKET) {
    console.log('[GC] ASSETS_BUCKET tidak terkonfigurasi');
    return { success: false, message: 'ASSETS_BUCKET tidak terkonfigurasi' };
  }

  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.log('[GC] Supabase key belum ada');
    return { success: false, message: 'Supabase key belum ada' };
  }

  try {
    const [prodRes, setRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/products?select=image_url', {
        headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
      }),
      fetch(SUPABASE_URL + '/rest/v1/settings?select=profile_image_url,background_url', {
        headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
      })
    ]);

    const products = await prodRes.json();
    const settings = await setRes.json();

    const activeKeys = new Set();
    const collectKey = (url) => {
      if (!url || typeof url !== 'string') return;
      const match = url.match(/\/cdn\/(.+)/);
      if (match) activeKeys.add(decodeURIComponent(match[1].split('?')[0]));
    };

    if (Array.isArray(products)) products.forEach((p) => collectKey(p.image_url));
    if (Array.isArray(settings)) settings.forEach((s) => {
      collectKey(s.profile_image_url);
      collectKey(s.background_url);
    });

    let truncated = true;
    let cursor = undefined;
    let deletedCount = 0;
    let keptCount = 0;
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;

    while (truncated) {
      const list = await env.ASSETS_BUCKET.list({ prefix: 'assets/', cursor });
      for (const obj of list.objects) {
        const uploadTime = obj.uploaded ? obj.uploaded.getTime() : 0;
        if (activeKeys.has(obj.key) || uploadTime > fortyEightHoursAgo) {
          keptCount++;
          continue;
        }
        await env.ASSETS_BUCKET.delete(obj.key);
        deletedCount++;
        console.log('[GC] Deleted orphan: ' + obj.key);
      }
      truncated = list.truncated;
      cursor = list.cursor;
    }

    console.log('[GC] Sukses: ' + deletedCount + ' file sampah dihapus, ' + keptCount + ' file aktif dipertahankan.');
    return { success: true, deleted: deletedCount, kept: keptCount };
  } catch (err) {
    console.error('[GC Error]:', err);
    return { success: false, error: err.message };
  }
}

// --- Router Utama ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/scrape-product" && request.method === "POST") {
      return handleScrapeProduct(request);
    }

    if (url.pathname === "/api/public/store" && request.method === "GET") {
      return handlePublicStore(request, env, ctx);
    }

    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      return handleCreatePayment(request, env);
    }

    if (url.pathname === "/api/webhook/gapura" && request.method === "POST") {
      return handleGapuraWebhook(request, env);
    }

    if (url.pathname === "/api/track" && request.method === "POST") {
      return handleTrack(request, env, ctx);
    }

    if (url.pathname === "/api/admin/analytics" && request.method === "GET") {
      return handleAdminAnalytics(request, env, ctx);
    }

    if (url.pathname === "/api/check-voucher" && request.method === "POST") {
      return handleCheckVoucher(request, env);
    }

    if (url.pathname === "/api/register-influencer" && request.method === "POST") {
      return handleRegisterInfluencer(request, env);
    }

    
    

    // GC Routes - Manual trigger for testing
    if (url.pathname === "/api/admin/run-gc" && request.method === "POST") {
      const gcResult = await handleGarbageCollector(env);
      return jsonResponse(gcResult);
    }

    // R2 Storage Routes
    if (url.pathname.startsWith("/cdn/") && request.method === "GET") {
      return handleCDN(request, env);
    }
    if (url.pathname === "/api/upload-image" && request.method === "POST") {
      return handleUploadImage(request, env);
    }
    if (url.pathname === "/api/delete-image" && request.method === "POST") {
      return handleDeleteImage(request, env);
    }
    if (url.pathname === "/api/clear-cache" && request.method === "POST") {
      return handleClearCache(request, env);
    }
    if (request.method === "GET") {
      return handlePageRender(request, env, ctx);
    }

    return jsonResponse({ success: false, message: "Not found." }, 404);
  },

  // --- Scheduled: Orphan Garbage Collector (setiap 5 hari jam 20:00) ---
  async scheduled(event, env, ctx) {
    console.log("[Cron] Starting scheduled garbage collection...");
    ctx.waitUntil(handleGarbageCollector(env));
  }
};

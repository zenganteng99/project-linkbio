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
    const formData = await request.formData();
    const file = formData.get("file");
    const oldUrl = formData.get("oldUrl");
    
    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "File is required" }, 400);
    }
    
    const ext = file.name ? file.name.split(".").pop() : 'jpg';
    const filename = 'assets/' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + ext;
    
    const arrayBuffer = await file.arrayBuffer();
    const fileContent = new Uint8Array(arrayBuffer);
    
    await env.ASSETS_BUCKET.put(filename, fileContent, {
      httpMetadata: { contentType: file.type || "image/jpeg" }
    });
    
    const primaryDomain = env.PRIMARY_DOMAIN || "https://customlink.pages.dev";
    const publicUrl = primaryDomain + '/cdn/' + filename;
    
    return jsonResponse({ success: true, url: publicUrl, filename: filename });
  } catch (err) {
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
      } catch(e) {}
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
function normalizePublicKeyPem(raw) {
  const key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PUBLIC KEY")) return key;
  
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  return "-----BEGIN PUBLIC KEY-----\n" + lines.join("\n") + "\n-----END PUBLIC KEY-----";
}

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

async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifySnapSignature(endpointUrl, rawBody, signatureB64, timestamp, publicKeyPem) {
  if (!publicKeyPem || !signatureB64 || !timestamp) return false;
  
  try {
    const bodyHash = await sha256Hex(rawBody);
    const stringToSign = "POST:" + endpointUrl + ":" + bodyHash + ":" + timestamp;
    const keyData = pemToArrayBuffer(publicKeyPem);
    const publicKey = await crypto.subtle.importKey(
      "spki", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    
    const signatureBinary = atob(signatureB64);
    const signatureBytes = new Uint8Array(signatureBinary.length);
    for (let i = 0; i < signatureBinary.length; i++) {
      signatureBytes[i] = signatureBinary.charCodeAt(i);
    }
    
    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", publicKey, signatureBytes, new TextEncoder().encode(stringToSign)
    );
    return isValid;
  } catch (err) {
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

// --- Handler: POST /api/create-payment ---
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
      message: "Konfigurasi gateway pembayaran DANA di server belum lengkap."
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
    return jsonResponse({ success: false, message: "Gagal menandatangani permintaan ke DANA." }, 500);
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
    return jsonResponse({ success: false, message: "Tidak dapat menghubungi API DANA.", detail: { stage: "network" }}, 504);
  }

  let rawText = await gatewayResponse.text();
  let gatewayData = null;
  try { gatewayData = rawText ? JSON.parse(rawText) : null; } catch (e) {}

  if (!gatewayResponse.ok) {
    const gwMsg = extractGatewayMessage(gatewayData);
    const rejectStatus = gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? gatewayResponse.status : 502;
    return jsonResponse({ success: false, message: "API DANA menolak (HTTP " + gatewayResponse.status + (gwMsg ? " - " + gwMsg : "") + ").", detail: gatewayData }, rejectStatus);
  }

  const paymentUrl = extractPaymentUrl(gatewayData);
  if (!paymentUrl) {
    return jsonResponse({ success: false, message: "API DANA tidak mengembalikan URL pembayaran.", detail: gatewayData }, 502);
  }

  return jsonResponse({ success: true, orderId: orderId, paymentUrl: paymentUrl, danaResponse: gatewayData }, 200);
}

// --- Handler: POST /api/webhook/gapura ---
function generateSlug(name, orderId) {
  const base = String(name || "client").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return base + "-" + String(orderId || Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8);
}

async function handleGapuraWebhook(request, env) {
  let rawBody;
  try { rawBody = await request.text(); } catch (e) { return jsonResponse({ status: "INVALID", message: "Failed to read request body." }, 400); }
  if (!rawBody || !rawBody.trim()) return jsonResponse({ status: "INVALID", message: "Empty request body." }, 400);
  
  let payload;
  try { payload = JSON.parse(rawBody); } catch (e) { return jsonResponse({ status: "INVALID", message: "Payload tidak valid." }, 400); }
  
  const signature = request.headers.get('X-SIGNATURE');
  const timestamp = request.headers.get('X-TIMESTAMP');
  
  if (env.DANA_PUBLIC_KEY) {
    if (!signature || !timestamp) return jsonResponse({ status: "INVALID", message: "Missing headers." }, 400);
    const publicKeyPem = normalizePublicKeyPem(env.DANA_PUBLIC_KEY);
    const isValid = await verifySnapSignature("/api/webhook/gapura", rawBody, signature, timestamp, publicKeyPem);
    if (!isValid) return jsonResponse({ status: "INVALID", message: "Invalid signature." }, 401);
  }
  
  const responseCode = payload.responseCode || payload.responseHeader?.responseCode;
  if (responseCode !== '2005400') {
    return jsonResponse({ status: "IGNORED", message: "Payment not successful." }, 200);
  }

  const orderId = payload.orderId || payload.originalPartnerReferenceNo || payload.partnerReferenceNo || payload.originalReferenceNo;
  const addInfo = payload.additionalInfo || {};
  const customerName = payload.customerName || payload.buyerName || addInfo.buyerName || "Client";
  const customerPhone = payload.customerPhone || payload.buyerPhone || addInfo.buyerPhone || "";
  const packageName = payload.packageName || addInfo.packageName || "Starter";

  if (!orderId) return jsonResponse({ status: "INVALID", message: "orderId tidak ditemukan." }, 400);

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!serviceKey) return jsonResponse({ status: "ERROR", message: "Konfigurasi Supabase belum lengkap." }, 500);
  
  try {
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?order_id=eq.${encodeURIComponent(orderId)}&select=id,slug`, {
      headers: { "apikey": serviceKey, "Authorization": "Bearer " + serviceKey }
    });
    if (checkRes.ok) {
      const existingClients = await checkRes.json();
      if (existingClients && existingClients.length > 0) {
        return jsonResponse({ status: "OK", message: "Order already processed.", slug: existingClients[0].slug, idempotent: true }, 200);
      }
    }
  } catch (idempErr) {}

  const isUpgrade = String(orderId).startsWith("UPG-") || Boolean(addInfo.isUpgrade);

  if (isUpgrade) {
    let clientSlug = addInfo.clientSlug;
    if (!clientSlug && String(orderId).startsWith("UPG-")) clientSlug = orderId.split("-")[1];
    clientSlug = (clientSlug || "default").trim().toLowerCase();

    let targetMax = Number(addInfo.targetMaxProducts) || (packageName.toLowerCase().includes("ultimate") ? 50 : 30);
    const amountVal = Number(payload.amount?.value || addInfo.amount || 0);

    try {
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_package_upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": serviceKey, "Authorization": "Bearer " + serviceKey },
        body: JSON.stringify({ p_order_id: orderId, p_client_slug: clientSlug, p_target_package: packageName, p_target_max: targetMax, p_amount: amountVal })
      });

      if (!rpcRes.ok) return jsonResponse({ status: "ERROR", message: "Gagal memproses upgrade di Supabase" }, 502);

      try {
        const cache = caches.default;
        await cache.delete(new Request(PRIMARY_DOMAIN + "/api/public/store?slug=" + encodeURIComponent(clientSlug)));
      } catch (cErr) {}

      return jsonResponse({ status: "OK", message: "Upgrade sukses", client_slug: clientSlug, max_products: targetMax }, 200);
    } catch (uErr) {
      return jsonResponse({ status: "ERROR", message: "Kesalahan server: " + uErr.message }, 500);
    }
  }

  const clientSlug = generateSlug(customerName, orderId);
  const defaultPin = "123456";
  let targetMaxProducts = 10;
  if (packageName.toLowerCase().includes("pro")) targetMaxProducts = 30;
  if (packageName.toLowerCase().includes("ultimate")) targetMaxProducts = 50;

  try {
    const clientRes = await fetch(SUPABASE_URL + "/rest/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": serviceKey, "Authorization": "Bearer " + serviceKey },
      body: JSON.stringify({ order_id: orderId, name: customerName, phone: customerPhone, package: packageName, slug: clientSlug, status: "active" })
    });

    if (!clientRes.ok) return jsonResponse({ status: "ERROR", message: "Gagal menyimpan data klien." }, 502);

    await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": serviceKey, "Authorization": "Bearer " + serviceKey },
      body: JSON.stringify({ client_slug: clientSlug, admin_pin: defaultPin, profile_name: customerName, max_products: targetMaxProducts })
    }).catch(() => {});

    return jsonResponse({ status: "OK", message: "Aktivasi berhasil", slug: clientSlug, max_products: targetMaxProducts }, 200);
  } catch (err) {
    return jsonResponse({ status: "ERROR", message: "Kesalahan internal webhook." }, 500);
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

// --- Handler: POST /api/scrape-product (Server-Side + Client-Side Fallback) ---
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

  const isShopee = targetUrl.includes("shopee") || targetUrl.includes("shope.ee");

  try {
    // ============================================================
    // SHOPEE: Try Server-Side First
    // ============================================================
    if (isShopee) {
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8"
      };

      let shopId = null, itemId = null;
      let currentUrl = targetUrl;

      // Chase redirects
      for (let i = 0; i < 8; i++) {
        try {
          const resp = await fetch(currentUrl, { headers, redirect: "manual" });
          if (resp.status >= 300 && resp.status < 400) {
            let loc = resp.headers.get("location");
            if (!loc) break;
            loc = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;

            // Extract IDs
            const match = loc.match(/-i\.(\d+)\.(\d+)/) || loc.match(/\/product\/(\d+)\/(\d+)/);
            if (match) { shopId = match[1]; itemId = match[2]; break; }

            // Decode nested URL
            if (loc.includes("shopee")) {
              const u = new URL(loc);
              const nested = u.searchParams.get("url") || u.searchParams.get("l");
              if (nested) {
                try {
                  let decoded = decodeURIComponent(nested);
                  if (decoded.includes("%")) decoded = decodeURIComponent(decoded);
                  const nestedMatch = decoded.match(/-i\.(\d+)\.(\d+)/);
                  if (nestedMatch) { shopId = nestedMatch[1]; itemId = nestedMatch[2]; break; }
                } catch (e) {}
              }
            }
            currentUrl = loc;
          } else {
            break;
          }
        } catch (e) { break; }
      }

      // Try API
      if (shopId && itemId) {
        const apiUrls = [
          `https://shopee.co.id/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
          `https://shopee.co.id/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`
        ];

        for (const apiUrl of apiUrls) {
          try {
            const resp = await fetch(apiUrl, {
              headers: { "User-Agent": headers["User-Agent"], "Accept": "application/json", "Referer": "https://shopee.co.id/" }
            });
            if (resp.ok) {
              const data = await resp.json();
              let title = "", imageUrl = "", price = "";

              if (data?.data?.name) {
                title = data.data.name;
                if (data.data.image) imageUrl = `https://cf.shopee.co.id/file/${data.data.image}`;
                if (data.data.price) price = String(Math.floor(Number(data.data.price) / 100000));
              } else if (data?.item?.name) {
                title = data.item.name;
                if (data.item.images?.[0]) imageUrl = `https://cf.shopee.co.id/file/${data.item.images[0]}`;
                if (data.item.price) price = String(Math.floor(Number(data.item.price) / 100000));
              }

              if (title) {
                title = decodeHtmlEntities(title).replace(/\s*[|\-]\s*Shopee.*$/gi, "").trim();
                if (title.length >= 3 && !title.toLowerCase().includes("shopee indonesia")) {
                  return jsonResponse({ success: true, data: { title, imageUrl, price, source: "server" } }, 200);
                }
              }
            }
          } catch (e) {}
        }
      }

      // Try CORS proxies
      const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
      ];

      for (const proxyUrl of proxies) {
        try {
          const resp = await fetch(proxyUrl, { headers });
          if (resp.ok) {
            const html = await resp.text();
            const jsonMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
            if (jsonMatch) {
              try {
                const json = JSON.parse(jsonMatch[1]);
                const paths = [["props","pageProps","product","name"], ["pageProps","product","name"]];
                let title = "", imageUrl = "", price = "";
                for (const path of paths) {
                  let v = json;
                  for (const k of path) v = v?.[k];
                  if (v && typeof v === 'string' && v.length > 5) { title = v; break; }
                }
                if (title) {
                  title = decodeHtmlEntities(title).replace(/\s*[|\-]\s*Shopee.*$/gi, "").trim();
                  if (title.length >= 3) {
                    return jsonResponse({ success: true, data: { title, imageUrl, price, source: "proxy" } }, 200);
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      // ALL SERVER METHODS FAILED -> Client-Side Fallback
      console.log("All server methods failed, returning client-side fallback");
      return jsonResponse({
        success: false,
        requiresClientScraping: true,
        targetUrl: targetUrl,
        message: "Server blocked. Scraping dari browser Anda..."
      }, 200);
    }

    // ============================================================
    // TIKTOK/TOKOPEDIA: Googlebot Cloaking (Works)
    // ============================================================
    const botHeaders = {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };

    const htmlResp = await fetch(targetUrl, { headers: botHeaders, redirect: "follow" });
    const html = await htmlResp.text();

    let title = "", imageUrl = "", price = "";

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (ogTitle) title = ogTitle[1].trim();

    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImage) imageUrl = ogImage[1].trim();

    const jsonLd = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLd) {
      try {
        const ld = JSON.parse(jsonLd[1]);
        if (ld["@type"] === "Product") {
          if (!title && ld.name) title = ld.name;
          if (!imageUrl && ld.image) imageUrl = Array.isArray(ld.image) ? ld.image[0] : (typeof ld.image === 'object' ? ld.image.url : ld.image);
          if (!price && ld.offers?.price) price = String(Math.floor(Number(ld.offers.price)));
        }
      } catch (e) {}
    }

    if (!price) {
      const metaPrice = html.match(/<meta[^>]+property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i);
      if (metaPrice) price = String(Math.floor(Number(metaPrice[1].replace(/[^\d.]/g, ""))));
    }

    if (title) {
      title = decodeHtmlEntities(title).replace(/\s*[|\-]\s*(Tokopedia|TikTok).*$/gi, "").trim();
      if (title.length < 3) title = "";
    }

    if (!title) title = extractTitleFromUrlSlug(targetUrl);

    if (title || imageUrl) {
      return jsonResponse({ success: true, data: { title, imageUrl, price, source: "googlebot" } }, 200);
    }

    return jsonResponse({ success: false, message: "Gagal memproses detail produk." }, 422);

  } catch (err) {
    return jsonResponse({ success: false, message: "Terjadi kesalahan internal server." }, 500);
  }
}
// --- Handler: POST /api/track ---
async function handleTrack(request, env, ctx) {
  const ua = request.headers.get('user-agent') || '';
  if (/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview/i.test(ua)) return new Response(null, { status: 204 });
  
  try {
    const body = await request.json();
    const clientSlug = (body.clientSlug || body.slug || 'default').trim();
    const eventType = body.eventType || 'view';
    const targetId = String(body.targetId || '').trim();
    const cfDevice = request.headers.get('cf-device-type');
    let deviceType = 'desktop';
    if (cfDevice) {
        deviceType = (cfDevice.toLowerCase() === 'mobile' || cfDevice.toLowerCase() === 'tablet') ? 'mobile' : 'desktop';
    } else {
        const uaString = ua.toLowerCase();
        if (/(android|webos|iphone|ipad|ipod|blackberry|windows phone|mobile)/i.test(uaString)) {
            deviceType = 'mobile';
        }
    }
    let rawRef = (body.referrer || 'direct').toLowerCase();
    let referrer = 'direct';
    if (rawRef.includes('instagram.com')) referrer = 'instagram';
    else if (rawRef.includes('tiktok.com')) referrer = 'tiktok';
    else if (rawRef.includes('google.')) referrer = 'google';
    else if (rawRef.includes('facebook.com')) referrer = 'facebook';
    else if (rawRef !== 'direct' && rawRef !== '') referrer = 'other';
    const country = request.cf?.country || request.headers.get('cf-ipcountry') || 'ID';
    const city = request.cf?.city || request.headers.get('cf-ipcity') || 'Indonesia';
    
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

// --- Handler: GET /api/admin/analytics ---
async function handleAdminAnalytics(request, env, ctx) {
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;
  
  const clientSlug = (cacheUrl.searchParams.get('clientSlug') || cacheUrl.searchParams.get('slug') || 'default').trim();
  
  try {
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

// --- Handler: GET /api/public/store ---
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
        cacheTimestamp: Date.now()
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
        return jsonResponse({ valid: false, message: "❌ Voucher endorse ini sudah pernah digunakan!" });
      }
      return jsonResponse({ valid: true, type: "endorse", discount_percent: 100, code: v.endorse_code });
    }

    const brokerRes = await fetch(`${SUPABASE_URL}/rest/v1/brokers?broker_code=ilike.${encodeURIComponent(code)}&select=*`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const brokerList = await brokerRes.json();
    if (brokerList && brokerList.length > 0) {
      return jsonResponse({ valid: true, type: "broker", discount_percent: 100, code: brokerList[0].broker_code });
    }

    const infRes = await fetch(`${SUPABASE_URL}/rest/v1/influencers?voucher_code=ilike.${encodeURIComponent(code)}&select=discount_percent`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const infList = await infRes.json();
    if (infList && infList.length > 0) {
      return jsonResponse({ valid: true, type: "influencer", discount_percent: infList[0].discount_percent || 30 });
    }

    return jsonResponse({ valid: false, message: "❌ Kode voucher tidak ditemukan. Diskon 0%." });
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
  const packageName = String(body.package || "Pro").trim();
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
    let isBrokerRoute = false;
    let brokerSlug = null;
    let commRate = 30;

    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/endorse_vouchers?endorse_code=ilike.${encodeURIComponent(endorseCode)}&is_used=eq.false&select=id`, {
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });
    const checkList = await checkRes.json();
    
    if (!checkList || checkList.length === 0) {
      const bRes = await fetch(`${SUPABASE_URL}/rest/v1/brokers?broker_code=ilike.${encodeURIComponent(endorseCode)}&select=slug`, {
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
      });
      const bList = await bRes.json();
      
      if (bList && bList.length > 0) {
        isBrokerRoute = true;
        brokerSlug = bList[0].slug;
        commRate = 20;
      } else {
        return jsonResponse({ success: false, message: "Kode voucher/broker tidak sah atau sudah terpakai." }, 400);
      }
    }

    const defaultPin = "123456";
    let targetMaxProducts = 30;
    if (packageName.toLowerCase().includes("ultimate")) targetMaxProducts = 50;
    if (packageName.toLowerCase().includes("starter")) targetMaxProducts = 10;

    await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
      method: "POST",
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "INF-" + slug + "-" + Date.now(), name: bankHolder || slug, phone: whatsapp, package: packageName, slug: slug, status: "active" })
    }).catch(e => console.error("Gagal create client:", e));

    await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
      method: "POST",
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_slug: slug, admin_pin: defaultPin, profile_name: bankHolder || slug, max_products: targetMaxProducts })
    }).catch(e => console.error("Gagal create settings:", e));

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/influencers`, {
      method: "POST",
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ client_slug: slug, voucher_code: voucher, discount_percent: 30, commission_rate: commRate, referred_by: brokerSlug, whatsapp: whatsapp, bank_name: bankName, bank_account: bankAccount, bank_holder: bankHolder })
    });
    if (!insRes.ok) {
      return jsonResponse({ success: false, message: "Gagal menyimpan: Client Slug mungkin sudah terpakai." }, 400);
    }

    if (!isBrokerRoute) {
      await fetch(`${SUPABASE_URL}/rest/v1/endorse_vouchers?endorse_code=ilike.${encodeURIComponent(endorseCode)}`, {
        method: "PATCH",
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ is_used: true })
      });
    }

    return jsonResponse({ success: true, message: "Aktivasi berhasil!" }, 200);
  } catch (err) {
    return jsonResponse({ success: false, message: "Kesalahan server saat memproses registrasi." }, 500);
  }
}

// --- Handler: Dynamic Open Graph & Meta SEO Injection ---
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
  if (!env.ASSETS_BUCKET) return { success: false, message: 'ASSETS_BUCKET tidak terkonfigurasi' };
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SUPABASE_SERVICE_KEY;
  if (!sbKey) return { success: false, message: 'Supabase key belum ada' };

  try {
    const [prodRes, setRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/products?select=image_url', { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }),
      fetch(SUPABASE_URL + '/rest/v1/settings?select=profile_image_url,background_url', { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } })
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
    if (Array.isArray(settings)) settings.forEach((s) => { collectKey(s.profile_image_url); collectKey(s.background_url); });

    let truncated = true;
    let cursor = undefined;
    let deletedCount = 0;
    let keptCount = 0;
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;

    while (truncated) {
      const list = await env.ASSETS_BUCKET.list({ prefix: 'assets/', cursor });
      for (const obj of list.objects) {
        const uploadTime = obj.uploaded ? obj.uploaded.getTime() : 0;
        if (activeKeys.has(obj.key) || uploadTime > fortyEightHoursAgo) { keptCount++; continue; }
        await env.ASSETS_BUCKET.delete(obj.key);
        deletedCount++;
      }
      truncated = list.truncated;
      cursor = list.cursor;
    }
    return { success: true, deleted: deletedCount, kept: keptCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Router Utama ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (url.pathname === "/api/scrape-product" && request.method === "POST") return handleScrapeProduct(request);
    if (url.pathname === "/api/public/store" && request.method === "GET") return handlePublicStore(request, env, ctx);
    if (url.pathname === "/api/create-payment" && request.method === "POST") return handleCreatePayment(request, env);
    if (url.pathname === "/api/webhook/gapura" && request.method === "POST") return handleGapuraWebhook(request, env);
    if (url.pathname === "/api/track" && request.method === "POST") return handleTrack(request, env, ctx);
    if (url.pathname === "/api/admin/analytics" && request.method === "GET") return handleAdminAnalytics(request, env, ctx);
    if (url.pathname === "/api/check-voucher" && request.method === "POST") return handleCheckVoucher(request, env);
    if (url.pathname === "/api/register-influencer" && request.method === "POST") return handleRegisterInfluencer(request, env);
    if (url.pathname === "/api/admin/run-gc" && request.method === "POST") return jsonResponse(await handleGarbageCollector(env));
    
    // R2 Storage Routes
    if (url.pathname.startsWith("/cdn/") && request.method === "GET") return handleCDN(request, env);
    if (url.pathname === "/api/upload-image" && request.method === "POST") return handleUploadImage(request, env);
    if (url.pathname === "/api/delete-image" && request.method === "POST") return handleDeleteImage(request, env);
    if (url.pathname === "/api/clear-cache" && request.method === "POST") return handleClearCache(request, env);
    if (request.method === "GET") return handlePageRender(request, env, ctx);

    return jsonResponse({ success: false, message: "Not found." }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleGarbageCollector(env));
  }
};
// customlink-webhook - DANA Payment Gateway (SNAP) + auto-activation klien
// Route:
//   OPTIONS /api/create-payment  -> CORS preflight
//   POST    /api/create-payment  -> buat transaksi pembayaran (SNAP createOrder)
//   POST    /api/webhook/gapura  -> auto-activation klien setelah pembayaran sukses

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

// Host resmi DANA (dana-node runtime getBasePathByEnv)
const DANA_HOSTS = {
  sandbox: "https://api.sandbox.dana.id",
  production: "https://api.saas.dana.id"
};
// Path resmi dana-node PaymentGatewayApi.createOrder
const DANA_CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";

const REDIRECT_URL = "https://customlink.pages.dev/landingpage";
const NOTIFY_URL = "https://customlink-webhook.modernshopp.workers.dev/api/webhook/gapura";

function jsonResponse(payload, status) {
  if (status === undefined) status = 200;
  return new Response(JSON.stringify(payload), {
    status: status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
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


// --- SNAP helpers (sesuai dana-node DanaHeaderUtil + DanaSignatureUtil) ---

// Timestamp SNAP: yyyy-MM-dd'T'HH:mm:ssXXX. Worker berjalan di UTC.
function snapTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "+00:00";
}

// validUpTo: YYYY-MM-DDTHH:mm:ss+07:00 (GMT+7), maks 7 hari ke depan. +24 jam.
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

// Secret bisa berupa base64 DER mentah atau PEM lengkap -> normalisasi ke PEM.
function normalizePrivateKeyPem(raw) {
  const key = String(raw || "").trim();
  if (!key) return "";
  if (key.includes("BEGIN PRIVATE KEY")) return key;
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  return "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----";
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function sha256Hex(text) {
  const dg = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(dg)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// X-SIGNATURE SNAP B2B = base64(RSA-SHA256("POST:<path>:<sha256hex(body)>:<ts>"))
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

// --- Handler: POST /api/create-payment (SNAP createOrder) ---
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

  if (!buyerName || !buyerPhone || !packageName || !Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({
      success: false,
      message: "Payload tidak lengkap: buyerName, buyerPhone, packageName, dan amount (>0) wajib diisi."
    }, 400);
  }

  const partnerId = String(env.CLIENT_ID || "").trim();
  const merchantId = String(env.MERCHANT_ID || "").trim();
  const privateKeyPem = normalizePrivateKeyPem(env.DANA_PRIVATE_KEY);
  if (!partnerId || !merchantId || !privateKeyPem) {
    console.error("Konfigurasi DANA belum lengkap (CLIENT_ID / MERCHANT_ID / DANA_PRIVATE_KEY).");
    return jsonResponse({
      success: false,
      message: "Konfigurasi gateway pembayaran DANA di server belum lengkap. Hubungi admin."
    }, 500);
  }

  const danaEnv = String(env.DANA_ENV || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
  const danaBaseUrl = DANA_HOSTS[danaEnv];
  const origin = new URL(request.url).origin;

  const orderId = "ORDER-" + Date.now();
  const amountStr = String(Math.round(amount)) + ".00";

  // Menggunakan Shop ID sandbox yang terdaftar di dashboard DANA Enterprise Anda
  const subMerchantId = "216660000003605019003";[cite: 47]

  const danaBody = {
    partnerReferenceNo: orderId,
    merchantId: merchantId,
    subMerchantId: subMerchantId,
    amount: { value: amountStr, currency: "IDR" },
    validUpTo: snapValidUpTo(),
    urlParams: [
      { url: REDIRECT_URL, type: "PAY_RETURN", isDeeplink: "N" },
      { url: NOTIFY_URL, type: "NOTIFICATION", isDeeplink: "N" }
    ],
    additionalInfo: { 
      mcc: '5734', 
      envInfo: { sourcePlatform: 'IPG', terminalType: 'SYSTEM' }, 
      order: { orderTitle: ('CustomLink ' + String(packageName || 'Package')).slice(0, 32), scenario: 'REDIRECT' } 
    }
  };
  const requestBodyStr = JSON.stringify(danaBody);
  const timestamp = snapTimestamp();
  const externalId = randomExternalId();

  let signature;
  try {
    signature = await snapB2BSignature(DANA_CREATE_ORDER_PATH, requestBodyStr, privateKeyPem, timestamp);
  } catch (signErr) {
    console.error("Gagal membuat X-SIGNATURE DANA:", signErr && signErr.message);
    return jsonResponse({
      success: false,
      message: "Gagal menandatangani permintaan ke DANA (format DANA_PRIVATE_KEY tidak valid). Hubungi admin."
    }, 500);
  }

  const snapHeaders = {
    "Content-Type": "application/json",
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "ORIGIN": origin,
    "X-PARTNER-ID": partnerId,
    "X-EXTERNAL-ID": externalId,
    "CHANNEL-ID": partnerId + "-SERVER",
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
    console.error("DANA network error:", networkErr && networkErr.message);
    return jsonResponse({
      success: false,
      message: "Tidak dapat menghubungi API gateway pembayaran DANA: " + (networkErr && networkErr.message),
      detail: { orderId: orderId, partnerReferenceNo: orderId, stage: "network" }
    }, 504);
  }

  let rawText = "";
  try {
    rawText = await gatewayResponse.text();
  } catch (e) {
    rawText = "";
  }

  let gatewayData = null;
  try {
    gatewayData = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    gatewayData = null;
  }

  if (!gatewayResponse.ok) {
    const gwMsg = extractGatewayMessage(gatewayData);
    console.error("DANA HTTP error", gatewayResponse.status, rawText.slice(0, 500));
    return jsonResponse({
      success: false,
      message: "API gateway pembayaran DANA menolak permintaan (HTTP " + gatewayResponse.status +
        (gwMsg ? " - " + gwMsg : "") + ").",
      detail: {
        orderId: orderId,
        partnerReferenceNo: orderId,
        stage: "gateway-response",
        status: gatewayResponse.status,
        danaResponseCode: gatewayData && (gatewayData.responseCode || (gatewayData.data || {}).responseCode),
        danaResponseMessage: gwMsg,
        response: rawText.slice(0, 1000)
      }
    }, 502);
  }

  const paymentUrl = extractPaymentUrl(gatewayData);
  if (!paymentUrl) {
    const gwMsg = extractGatewayMessage(gatewayData);
    console.error("DANA tidak mengembalikan paymentUrl:", rawText.slice(0, 500));
    return jsonResponse({
      success: false,
      message: "API gateway pembayaran DANA tidak mengembalikan URL pembayaran" +
        (gwMsg ? " (" + gwMsg + ")" : "") + ".",
      detail: {
        orderId: orderId,
        partnerReferenceNo: orderId,
        stage: "missing-payment-url",
        danaResponseCode: gatewayData && (gatewayData.responseCode || (gatewayData.data || {}).responseCode),
        danaResponseMessage: gwMsg,
        response: rawText.slice(0, 1000)
      }
    }, 502);
  }

  return jsonResponse({ success: true, orderId: orderId, paymentUrl: paymentUrl, danaResponse: gatewayData }, 200);
}

// --- Handler: POST /api/webhook/gapura (auto-activation klien) ---
function generateSlug(name, orderId) {
  const base = String(name || "client").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return base + "-" + String(orderId || Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8);
}

async function handleGapuraWebhook(request, env) {
  const SUPABASE_URL = "https://aonbjbcytrpjaxuhyucq.supabase.co";
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ status: "INVALID", message: "Payload webhook tidak valid." }, 400);
  }

  const orderId = payload.orderId || payload.originalPartnerReferenceNo ||
    payload.partnerReferenceNo || payload.originalReferenceNo;
  const addInfo = payload.additionalInfo || {};
  const customerName = payload.customerName || payload.buyerName || addInfo.buyerName || "Client";
  const customerPhone = payload.customerPhone || payload.buyerPhone || addInfo.buyerPhone || "";
  const packageName = payload.packageName || addInfo.packageName || "Starter";

  if (!orderId) {
    return jsonResponse({ status: "INVALID", message: "orderId tidak ditemukan di payload webhook." }, 400);
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY belum di-set.");
    return jsonResponse({ status: "ERROR", message: "Konfigurasi Supabase di server belum lengkap." }, 500);
  }

  const clientSlug = generateSlug(customerName, orderId);

  try {
    const response = await fetch(SUPABASE_URL + "/rest/v1/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
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

    if (!response.ok) {
      const errText = await response.text();
      console.error("Supabase insert gagal:", response.status, errText.slice(0, 500));
      return jsonResponse({ status: "ERROR", message: "Gagal menyimpan data klien.", detail: errText.slice(0, 500) }, 502);
    }

    return jsonResponse({ status: "OK", message: "Account auto-activated successfully", slug: clientSlug }, 200);
  } catch (err) {
    console.error("Webhook error:", err && err.message);
    return jsonResponse({ status: "ERROR", message: "Kesalahan internal webhook: " + (err && err.message) }, 500);
  }
}

// --- Router utama (ES module, binding env via argumen fetch) ---
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/create-payment" && request.method === "POST") {
      return handleCreatePayment(request, env);
    }

    if (url.pathname === "/api/webhook/gapura" && request.method === "POST") {
      return handleGapuraWebhook(request, env);
    }

    return jsonResponse({ success: false, message: "Not found." }, 404);
  }
};
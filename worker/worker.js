// customlink-webhook - DANA Payment Gateway (SNAP) + auto-activation klien + Dynamic SEO Engine + Analytics
// Route:
//   OPTIONS /api/*              -> CORS preflight
//   POST    /api/create-payment -> Buat transaksi pembayaran (SNAP createOrder)
//   POST    /api/webhook/gapura -> Auto-aktivasi klien setelah pembayaran sukses
//   POST    /api/track          -> Ingestion pelacakan analitik pengunjung & klik (Non-blocking)
//   GET     /api/admin/analytics-> Penarikan ringkasan data analitik 7 hari untuk admin
//   GET     /*                  -> Cloudflare Pages Proxy + Dynamic Open Graph & Meta SEO Injection
//
// ---------------------------------------------------------------------------
// Konfigurasi DANA (env) — lihat worker/wrangler.toml [vars] + wrangler secret:
//   MERCHANT_ID        : Merchant ID dari dashboard.dana.id (sandbox != production)
//   CLIENT_ID          : X-PARTNER-ID dari dashboard.dana.id
//   DANA_PRIVATE_KEY   : (secret) RSA PKCS#8 PEM untuk X-SIGNATURE
//   DANA_ENV           : "sandbox" (api.sandbox.dana.id) | "production" (api.saas.dana.id)
//   DANA_ORIGIN        : origin aplikasi yang terdaftar (JANGAN origin *.workers.dev)
//   SUB_MERCHANT_ID    : External DIVISION ID (tab "Division"), BUKAN External Shop ID!
//                        Kosongkan bila transaksi tidak memakai skema Division.
//   EXTERNAL_STORE_ID  : External Shop ID (opsional, tab "Shop")
//   DANA_CHANNEL_ID    : CHANNEL-ID 1-5 karakter (nilai dashboard DANA: 95221)
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const DANA_HOSTS = {
  sandbox: "https://api.sandbox.dana.id",
  production: "https://api.saas.dana.id"
};
const DANA_CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";

const REDIRECT_URL = "https://customlink.pages.dev/";
const NOTIFY_URL = "https://customlink-webhook.modernshopp.workers.dev/api/webhook/gapura";
const PAGES_ORIGIN = "https://customlink.pages.dev";
const DEFAULT_CHANNEL_ID = "95221";

// Supabase Connection & Fallback Keys (Kunci aman dimuat dari Cloudflare Secrets)
const SUPABASE_URL = "https://aonbjbcytrpjaxuhyucq.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "";
const DEFAULT_SUPABASE_SERVICE_KEY = "";

function jsonResponse(payload, status = 200) {
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
    return jsonResponse({
      success: false,
      message: "Konfigurasi gateway pembayaran DANA di server belum lengkap. Hubungi admin."
    }, 500);
  }

  const danaEnv = String(env.DANA_ENV || "sandbox").toLowerCase() === "production" ? "production" : "sandbox";
  const danaBaseUrl = DANA_HOSTS[danaEnv];
  const origin = String(env.DANA_ORIGIN || PAGES_ORIGIN).trim().replace(/\/+$/, "") || PAGES_ORIGIN;

  const orderId = "ORDER-" + Date.now();
  const amountStr = String(Math.round(amount)) + ".00";
  const subMerchantId = String(env.SUB_MERCHANT_ID || "").trim();
  const externalStoreId = String(env.EXTERNAL_STORE_ID || "").trim();

  const danaBody = {
    partnerReferenceNo: orderId,
    merchantId: merchantId,
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
    console.error("[DANA create-payment] ditolak", JSON.stringify({
      httpStatus: gatewayResponse.status,
      responseCode: gwCode || null,
      responseMessage: gwMsg || null,
      debugMessage: gwDebug || null,
      orderId: orderId,
      externalId: externalId,
      origin: origin,
      channelId: snapHeaders["CHANNEL-ID"],
      subMerchantId: subMerchantId || null,
      externalStoreId: externalStoreId || null
    }));
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
    console.error("[DANA create-payment] tanpa webRedirectUrl", JSON.stringify({
      httpStatus: gatewayResponse.status, responseCode: gwCode || null, debugMessage: gwDebug || null,
      orderId: orderId, body: String(rawText || "").slice(0, 600)
    }));
    return jsonResponse({
      success: false,
      orderId: orderId,
      responseCode: gwCode || null,
      debugMessage: gwDebug || null,
      message: "API gateway pembayaran DANA tidak mengembalikan URL pembayaran." + (gwMsg ? " (" + gwMsg + ")" : ""),
      detail: gatewayData
    }, 502);
  }

  console.log("[DANA create-payment] sukses " + orderId + " subMerchantId=" + (subMerchantId || "-") +
    " origin=" + origin + " channelId=" + snapHeaders["CHANNEL-ID"]);
  return jsonResponse({ success: true, orderId: orderId, paymentUrl: paymentUrl, danaResponse: gatewayData }, 200);
}

// --- Handler: POST /api/webhook/gapura ---
function generateSlug(name, orderId) {
  const base = String(name || "client").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
  return base + "-" + String(orderId || Date.now()).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8);
}

async function handleGapuraWebhook(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ status: "INVALID", message: "Payload webhook tidak valid." }, 400);
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

  const clientSlug = generateSlug(customerName, orderId);

  try {
    const response = await fetch(SUPABASE_URL + "/rest/v1/clients", {
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

    if (!response.ok) {
      return jsonResponse({ status: "ERROR", message: "Gagal menyimpan data klien." }, 502);
    }
    return jsonResponse({ status: "OK", message: "Akun berhasil diaktifkan secara otomatis", slug: clientSlug }, 200);
  } catch (err) {
    return jsonResponse({ status: "ERROR", message: "Kesalahan internal webhook: " + (err && err.message) }, 500);
  }
}

// --- Handler: POST /api/track (Analytics Ingestion Non-blocking) ---
async function handleTrack(request, env, ctx) {
  const ua = request.headers.get("user-agent") || "";
  if (/bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview/i.test(ua)) {
    return new Response(null, { status: 204 });
  }

  try {
    const body = await request.json();
    const clientSlug = (body.clientSlug || body.slug || "default").trim();
    const eventType = body.eventType || "view";
    const targetId = String(body.targetId || "").trim();

    // Deteksi Perangkat Otomatis via Cloudflare Header
    const cfDevice = (request.headers.get("cf-device-type") || "desktop").toLowerCase();
    const deviceType = (cfDevice === "mobile" || cfDevice === "tablet") ? "mobile" : "desktop";

    // Normalisasi Referrer Domain
    let rawRef = (body.referrer || "direct").toLowerCase();
    let referrer = "direct";
    if (rawRef.includes("instagram.com")) referrer = "instagram";
    else if (rawRef.includes("tiktok.com")) referrer = "tiktok";
    else if (rawRef.includes("google.")) referrer = "google";
    else if (rawRef.includes("facebook.com")) referrer = "facebook";
    else if (rawRef !== "direct" && rawRef !== "") referrer = "other";

    // Deteksi Geolokasi Pengunjung via Edge Cloudflare
    const country = request.cf?.country || request.headers.get("cf-ipcountry") || "ID";
    const city = request.cf?.city || request.headers.get("cf-ipcity") || "Indonesia";

    // Eksekusi RPC ke Supabase di background tanpa menahan response
    const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_SERVICE_KEY || DEFAULT_SUPABASE_ANON_KEY;
    const task = fetch(`${SUPABASE_URL}/rest/v1/rpc/record_analytics_event`, {
      method: "POST",
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_client_slug: clientSlug,
        p_event_type: eventType,
        p_device_type: deviceType,
        p_referrer: referrer,
        p_target_id: targetId,
        p_country: country,
        p_city: city
      })
    }).catch((err) => console.error("[Analytics Error]", err));

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(task);
    }

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ error: "Invalid Payload" }, 400);
  }
}

// --- Handler: GET /api/admin/analytics (Ringkasan Data Analitik 7 Hari) ---
async function handleAdminAnalytics(request, env) {
  const url = new URL(request.url);
  const clientSlug = (url.searchParams.get("clientSlug") || url.searchParams.get("slug") || "default").trim();

  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_SERVICE_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!sbKey) {
    return jsonResponse({ error: "Konfigurasi Supabase belum lengkap." }, 500);
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_analytics_summary_7d`, {
      method: "POST",
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_client_slug: clientSlug })
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ error: "Gagal mengambil data analitik: " + errText }, res.status);
    }

    const data = await res.json();
    return jsonResponse(data, 200);
  } catch (err) {
    return jsonResponse({ error: "Kesalahan internal analitik: " + (err && err.message) }, 500);
  }
}

// --- Handler: Dynamic Open Graph & Meta SEO Injection via HTMLRewriter ---
async function handlePageRender(request, env) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const pagesHost = new URL(PAGES_ORIGIN).host;

  if (url.pathname.includes(".") && !url.pathname.endsWith(".html")) {
    return fetch(PAGES_ORIGIN + url.pathname, {
      headers: { "Host": pagesHost }
    });
  }

  const slug = segments.length > 0 ? segments[0] : "";
  const isSpecialPath = ["admin", "api"].includes(slug.toLowerCase());

  if (!slug || isSpecialPath) {
    const targetPath = slug === "admin" ? "/admin.html" : url.pathname;
    return fetch(PAGES_ORIGIN + targetPath, {
      headers: { "Host": pagesHost }
    });
  }

  const response = await fetch(PAGES_ORIGIN + "/store.html", {
    headers: { "Host": pagesHost }
  });

  let seo = {
    title: "Bio Link Katalog",
    description: "Katalog produk resmi dan link diskon eksklusif.",
    image: `${PAGES_ORIGIN}/images/default-og.png`,
    url: url.href
  };

  try {
    const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_SERVICE_KEY || DEFAULT_SUPABASE_ANON_KEY;
    if (sbKey) {
      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?client_slug=eq.${encodeURIComponent(slug)}&select=profile_name,hero_title,hero_subtitle,profile_image_url,background_url`,
        {
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`
          }
        }
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

  return new HTMLRewriter()
    .on("title", {
      element(e) {
        e.setInnerContent(seo.title);
      }
    })
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
}

// --- Router Utama ---
export default {
  async fetch(request, env, ctx) {
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

    if (url.pathname === "/api/track" && request.method === "POST") {
      return handleTrack(request, env, ctx);
    }

    if (url.pathname === "/api/admin/analytics" && request.method === "GET") {
      return handleAdminAnalytics(request, env);
    }

    if (request.method === "GET") {
      return handlePageRender(request, env);
    }

    return jsonResponse({ success: false, message: "Not found." }, 404);
  }
};
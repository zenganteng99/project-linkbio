#!/usr/bin/env node
/*
 * DANA sandbox Create Order UAT runner (Node 18+; built-in modules only).
 * Default: 4005402, 4005401, 4045418, 4015400. Optional baseline: --only 2005400.
 * 4045418 first creates a valid order, then changes only its amount with a fresh
 * X-EXTERNAL-ID. These requests create sandbox orders, not completed payments.
 * Signing: POST:<relative path>:<lowercase SHA256(minified JSON)>:<timestamp>,
 * signed with RSA-SHA256, PKCS#8, Base64 (DANA asymmetric authentication docs).
 * Empty timestamp and fake signature follow dana-id/uat-script's Node tests.
 * Format candidates are local probes; their codes must be observed, not assumed.
 * API assertions do NOT verify portal completion. Check Mandatory API Testing
 * and API Logs manually after execution; this runner cannot guarantee 5/5.
 *
 * Credentials: local env files, worker/wrangler.toml fallback, shell overrides.
 * Never commit keys. The sandbox key must match the public key registered at DANA;
 * parsing/signing locally cannot establish that match without an API response.
 * Usage: node run_uat.mjs --dry-run | --only 4005401,4015400 | --json
 */
import { existsSync, readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";
const DANA_HOST = {
  sandbox: "https://api.sandbox.dana.id",
  production: "https://api.saas.dana.id"
};
const DEFAULT_CHANNEL_ID = "95221"; // 1-5 karakter (spec SNAP) = nilai Sample Payload dashboard DANA
const DEFAULT_NOTIFY_URL = "https://customlink-webhook.modernshopp.workers.dev/api/webhook/gapura";
const MCC = "5734";
// Nilai X-SIGNATURE palsu pada skrip UAT resmi DANA (Node), 64 hex karakter.
const FAKE_SIGNATURE = "85be817c55b2c135157c7e89f52499bf0c25ad6eeebe04a986e8c862561b19a5";

const EXPECTED = {
  SUCCESS: "2005400",
  MANDATORY: "4005402",
  FORMAT: "4005401",
  INCONSISTENT: "4045418",
  UNAUTHORIZED: "4015400"
};

const MEANING = {
  "2005400": "Successful",
  "4005400": "Bad Request",
  "4005401": "Invalid Field Format",
  "4005402": "Invalid Mandatory Field",
  "4015400": "Unauthorized / Invalid Signature",
  "4045408": "Invalid Merchant (merchant tidak ada / status abnormal)",
  "4045418": "Inconsistent Request",
  "4095400": "Conflict (X-EXTERNAL-ID sudah dipakai hari ini)",
  "4295400": "Too Many Requests",
  "5005400": "General Error",
  "5005401": "Internal Server Error"
};

function usage() {
  return [
    "Penggunaan: node run_uat.mjs [opsi]",
    "",
    "Opsi:",
    "  --dry-run              Tampilkan rencana request tanpa mengirim apa pun (tidak butuh kunci).",
    "  --only <kode[,kode]>   Jalankan skenario tertentu: 2005400,4005402,4005401,4045418,4015400.",
    "  --amount <angka>       Nominal dasar (default 10000) -> dikirim sebagai \"10000.00\".",
    "  --delay <ms>           Jeda antar request (default 1500; hindari 4295400).",
    "  --max-probe <n>        Maksimum kandidat format untuk skenario 4005401 (1-7, default 7).",
    "  --key-file <path>      Berkas PEM private key (PKCS#8).",
    "  --env-file <path>      Berkas KEY=VALUE tambahan (boleh diulang).",
    "  --json                 Cetak hasil akhir sebagai JSON.",
    "  --help, -h             Tampilkan bantuan ini.",
    "",
    "Env yang dibaca: DANA_ENV, MERCHANT_ID, CLIENT_ID (atau X_PARTNER_ID), DANA_PRIVATE_KEY,",
    "  DANA_PRIVATE_KEY_PATH, DANA_ORIGIN, SUB_MERCHANT_ID / DANA_DIVISION_ID, EXTERNAL_STORE_ID,",
    "  DANA_CHANNEL_ID, NOTIFY_URL, DANA_X_DEBUG (true/false)."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    dryRun: false, only: null, amount: 10000, delay: 1500, maxProbe: 7,
    json: false, help: false, keyFile: null, envFiles: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("Missing value for " + a);
      return value;
    };
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only = String(next() || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--amount") args.amount = Number(next());
    else if (a === "--delay") args.delay = Number(next());
    else if (a === "--max-probe") args.maxProbe = Number(next());
    else if (a === "--key-file") args.keyFile = path.resolve(next());
    else if (a === "--env-file") args.envFiles.push(path.resolve(next()));
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.trim()) throw new Error("Unknown argument: " + a);
  }
  if (!Number.isFinite(args.amount) || args.amount <= 0 || args.amount.toFixed(2).length > 19 ||
      Math.abs(args.amount * 100 - Math.round(args.amount * 100)) > 0.00001) {
    throw new Error("--amount must be positive, at most 2 decimals, and within 19 characters.");
  }
  if (!Number.isInteger(args.delay) || args.delay < 0 || args.delay > 60000) throw new Error("--delay must be 0..60000 ms.");
  if (!Number.isInteger(args.maxProbe) || args.maxProbe < 1 || args.maxProbe > 7) throw new Error("--max-probe must be 1..7.");
  if (args.only && (!args.only.length || args.only.some((code) => !Object.hasOwn(SCENARIOS, code)))) {
    throw new Error("--only contains an unknown or empty scenario code.");
  }
  if (args.only) args.only = [...new Set(args.only)];
  return args;
}

// ---------------------------------------------------------------------------
// Konfigurasi: berkas KEY=VALUE + [vars] wrangler.toml (fallback) + env shell
// ---------------------------------------------------------------------------
function parseKeyValueFile(filePath) {
  const out = {};
  if (!filePath || !existsSync(filePath)) return out;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      while (!(value.length > 1 && value.endsWith(quote)) && i + 1 < lines.length) value += "\n" + lines[++i];
      if (!value.endsWith(quote) || value.length < 2) throw new Error("Unterminated quoted env value in " + filePath);
      value = value.slice(1, -1);
    } else if (value.startsWith("-----BEGIN ") && !value.includes("-----END ")) {
      while (!value.includes("-----END ") && i + 1 < lines.length) value += "\n" + lines[++i];
      if (!value.includes("-----END ")) throw new Error("Unterminated PEM in " + filePath);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[match[1]] = value;
  }
  return out;
}

// Hanya baris [vars] yang dibaca; nilai rahasia tidak pernah ada di berkas ini.
function parseWranglerVars(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  let inVars = false;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inVars = trimmed === "[vars]";
      continue;
    }
    if (!inVars || !trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadRawEnv(args) {
  const files = [
    path.join(REPO_ROOT, "env.local"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".dev.vars"),
    path.join(REPO_ROOT, "worker", ".dev.vars"),
    path.join(REPO_ROOT, "worker", ".env.local"),
    path.join(REPO_ROOT, "tools", "dana-diagnose", "env.local"),
    path.join(REPO_ROOT, "tools", "dana-diagnose", ".dev.vars")
  ].concat(args.envFiles || []);
  const merged = Object.assign({}, parseWranglerVars(path.join(REPO_ROOT, "worker", "wrangler.toml")));
  for (const file of args.envFiles || []) {
    if (!existsSync(file)) throw new Error("--env-file not found: " + file);
  }
  for (const file of files) Object.assign(merged, parseKeyValueFile(file));
  // Variabel shell selalu menang atas berkas.
  const watched = ["DANA_PRIVATE_KEY", "DANA_PRIVATE_KEY_PATH", "DANA_PRIVATE_KEY_FILE", "MERCHANT_ID",
    "CLIENT_ID", "X_PARTNER_ID", "DANA_ORIGIN", "SUB_MERCHANT_ID", "DANA_DIVISION_ID", "EXTERNAL_STORE_ID",
    "DANA_CHANNEL_ID", "DANA_ENV", "NOTIFY_URL", "DANA_X_DEBUG"];
  for (const key of Object.keys(merged)) {
    if (process.env[key] !== undefined && process.env[key] !== "") merged[key] = process.env[key];
  }
  for (const key of watched) {
    if (process.env[key]) merged[key] = process.env[key];
  }
  if (args.keyFile) merged.__KEY_FILE = args.keyFile;
  return merged;
}

function normalizePrivateKeyPem(raw) {
  let key = String(raw || "").trim();
  if (!key) return "";
  // PEM yang ditempel dalam satu baris biasanya memakai escape \n.
  if (key.includes("\\n") && !key.includes("\n")) key = key.replace(/\\n/g, "\n");
  if (key.includes("BEGIN PRIVATE KEY")) return key;
  if (key.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("Kunci berformat PKCS#1 (\"BEGIN RSA PRIVATE KEY\"). Runner ini memakai PKCS#8 " +
      "(\"BEGIN PRIVATE KEY\"). Konversi dengan: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
  }
  const b64 = key.replace(/\s+/g, "");
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.substring(i, i + 64));
  return "-----BEGIN PRIVATE KEY-----\n" + lines.join("\n") + "\n-----END PRIVATE KEY-----";
}

function resolvePrivateKey(env) {
  if (env.__KEY_FILE) {
    if (!existsSync(env.__KEY_FILE)) throw new Error("--key-file tidak ditemukan: " + env.__KEY_FILE);
    return { pem: normalizePrivateKeyPem(readFileSync(env.__KEY_FILE, "utf8")), source: env.__KEY_FILE };
  }
  const configuredPath = env.DANA_PRIVATE_KEY_PATH || env.DANA_PRIVATE_KEY_FILE;
  const keyPath = configuredPath ? path.resolve(REPO_ROOT, configuredPath) : null;
  if (keyPath && existsSync(keyPath)) {
    return { pem: normalizePrivateKeyPem(readFileSync(keyPath, "utf8")), source: keyPath };
  }
  if (keyPath) console.warn("[WARN] Berkas private key tidak ditemukan: " + keyPath);
  if (env.DANA_PRIVATE_KEY) return { pem: normalizePrivateKeyPem(env.DANA_PRIVATE_KEY), source: "env DANA_PRIVATE_KEY" };
  return { pem: "", source: null };
}

// channelId wajib 1-5 karakter (spec SNAP). Nilai lebih panjang diabaikan, sama seperti worker.js.
function resolveChannelId(env) {
  const raw = String(env.DANA_CHANNEL_ID || "").trim();
  if (raw && raw.length <= 5) return raw;
  if (raw) console.warn("[WARN] DANA_CHANNEL_ID diabaikan (" + raw.length + " karakter; wajib 1-5).");
  return DEFAULT_CHANNEL_ID;
}

// ---------------------------------------------------------------------------
// Helper SNAP — cermin persis worker/worker.js (snapTimestamp, sha256Hex, snapB2BSignature).
// X-SIGNATURE = RSA-SHA256 atas "POST:<endpoint path>:<SHA256-hex(body)>:<X-TIMESTAMP>".
// CATATAN PENTING: yang masuk stringToSign adalah SHA-256 (hex) dari body, BUKAN body mentah.
// Menandatangani body mentah membuat SEMUA request dijawab 4015400.
// ---------------------------------------------------------------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

// GMT+7 (Jakarta), 25 karakter: YYYY-MM-DDTHH:mm:ss+07:00
function snapTimestampGmt7(offsetSeconds) {
  const d = new Date(Date.now() + 7 * 3600 * 1000 + (Number(offsetSeconds) || 0) * 1000);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) +
    "T" + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()) + "+07:00";
}

// Format X-TIMESTAMP yang melanggar spec (spasi, bukan 'T') -> kandidat 4005401.
function malformedTimestampGmt7() {
  return snapTimestampGmt7(0).replace("T", " ");
}

async function sha256Hex(text) {
  const dg = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(dg)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signSnapB2B(privateKeyPem, timestamp, bodyStr) {
  const hashBody = await sha256Hex(bodyStr);
  const stringToSign = "POST:" + CREATE_ORDER_PATH + ":" + hashBody + ":" + timestamp;
  const b64 = privateKeyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  const key = await webcrypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  if (key.algorithm.modulusLength !== 2048) throw new Error("DANA signing requires RSA-2048.");
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(stringToSign));
  return Buffer.from(sig).toString("base64");
}

// X-EXTERNAL-ID: unik untuk setiap request, maksimum 36 karakter.
function randomExternalId() {
  const hex = "0123456789abcdef";
  const buf = new Uint8Array(16);
  webcrypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += hex[b >> 4] + hex[b & 15];
  return "uat" + s.substring(3, 31);
}

function maskSignature(sig) {
  const s = String(sig || "");
  if (!s) return "";
  return s.slice(0, 8) + "..." + s.slice(-4) + " (" + s.length + " char)";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Body & pengiriman request
// ---------------------------------------------------------------------------
function buildBody(ctx, overrides) {
  const o = overrides || {};
  const body = {
    partnerReferenceNo: o.partnerReferenceNo !== undefined ? o.partnerReferenceNo : ctx.newReferenceNo(),
    merchantId: o.merchantId !== undefined ? o.merchantId : ctx.merchantId,
    amount: {
      value: o.amountValue !== undefined ? o.amountValue : ctx.amountStr(),
      currency: o.currency !== undefined ? o.currency : "IDR"
    },
    validUpTo: o.validUpTo !== undefined ? o.validUpTo : snapTimestampGmt7(900),
    urlParams: [
      { url: ctx.origin + "/", type: "PAY_RETURN", isDeeplink: "N" },
      { url: ctx.notifyUrl, type: "NOTIFICATION", isDeeplink: "N" }
    ],
    additionalInfo: {
      mcc: MCC,
      envInfo: { sourcePlatform: "IPG", terminalType: "SYSTEM" },
      order: { orderTitle: "UAT DANA SNAP", scenario: "REDIRECT" }
    }
  };
  // Field opsional hanya dikirim bila terdaftar (pola worker.js:206-208).
  if (ctx.subMerchantId) body.subMerchantId = ctx.subMerchantId;
  if (ctx.externalStoreId) body.externalStoreId = ctx.externalStoreId;
  return body;
}

// timestampMode: "normal" | "omit" (header tidak dikirim) | "empty" | "malformed"
async function sendCreateOrder(ctx, opts) {
  const o = opts || {};
  const bodyStr = JSON.stringify(o.body);
  const mode = o.timestampMode || "normal";
  const signedTimestamp = mode === "malformed" ? malformedTimestampGmt7() : snapTimestampGmt7(0);
  const signature = o.signatureOverride !== undefined
    ? o.signatureOverride
    : await signSnapB2B(ctx.privateKeyPem, signedTimestamp, bodyStr);

  const headers = {
    "Content-Type": "application/json",
    "X-PARTNER-ID": ctx.partnerId,
    "X-EXTERNAL-ID": randomExternalId(),
    "CHANNEL-ID": ctx.channelId,
    "ORIGIN": ctx.origin,
    "X-SIGNATURE": signature
  };
  if (mode === "normal" || mode === "malformed") headers["X-TIMESTAMP"] = signedTimestamp;
  else if (mode === "empty") headers["X-TIMESTAMP"] = "";
  if (ctx.xDebug) headers["X-Debug-Mode"] = "true";

  const result = {
    label: o.label || "",
    timestampMode: mode,
    requestBody: o.body,
    signatureMasked: maskSignature(signature),
    httpStatus: null,
    responseCode: null,
    responseMessage: null,
    debugMessage: null,
    webRedirectUrl: null,
    networkError: null
  };

  try {
    const res = await fetch(ctx.host + CREATE_ORDER_PATH, { method: "POST", headers, body: bodyStr, signal: AbortSignal.timeout(15000), redirect: "error" });
    result.httpStatus = res.status;
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (e) { /* respons bukan JSON */ }
    if (data) {
      result.responseCode = data.responseCode || null;
      result.responseMessage = data.responseMessage || null;
      result.debugMessage = (data.additionalInfo && data.additionalInfo.debugMessage) || null;
      result.webRedirectUrl = data.webRedirectUrl || null;
      result.rawResponse = data;
    }
  } catch (err) {
    result.networkError = err && err.message ? err.message : String(err);
  }
  return result;
}

function describeResult(r) {
  if (r.networkError) return "network error: " + r.networkError;
  const code = r.responseCode || ("HTTP " + (r.httpStatus === null ? "?" : r.httpStatus));
  const extra = r.responseMessage || r.debugMessage || "";
  return code + (extra ? " - " + extra : "");
}

// ---------------------------------------------------------------------------
// Kandidat pelanggaran format untuk skenario 4005401 (Invalid Field Format).
// Urutan = dari yang paling mungkin. Runner berhenti begitu DANA membalas 4005401,
// jadi biasanya hanya kandidat pertama yang terkirim.
// ---------------------------------------------------------------------------
const FORMAT_CANDIDATES = [
  {
    label: "amount.value dengan 3 desimal (mis. 10000.000)",
    overrides: (ctx) => ({ amountValue: ctx.amount.toFixed(3) })
  },
  {
    label: 'amount.value kosong ("")',
    overrides: () => ({ amountValue: "" })
  },
  {
    label: 'merchantId kosong ("")',
    overrides: () => ({ merchantId: "" })
  },
  {
    label: "partnerReferenceNo 70 karakter (maksimum 64)",
    overrides: () => ({ partnerReferenceNo: "UAT-" + "x".repeat(66) })
  },
  {
    label: 'amount.currency 4 karakter ("IDRX", maksimum 3)',
    overrides: () => ({ currency: "IDRX" })
  },
  {
    label: 'validUpTo tanpa pemisah "T"',
    overrides: () => ({ validUpTo: snapTimestampGmt7(900).replace("T", " ") })
  },
  {
    label: 'X-TIMESTAMP "YYYY-MM-DD HH:mm:ss+07:00" (spasi, bukan "T")',
    timestampMode: "malformed",
    overrides: () => ({})
  }
];

// ---------------------------------------------------------------------------
// Skenario 1 — 2005400 (prasyarat skenario 4045418)
// ---------------------------------------------------------------------------
async function scenarioSuccess(ctx) {
  const r = await ctx.send({ label: "create order valid", body: ctx.base() });
  return {
    passed: r.responseCode === EXPECTED.SUCCESS, attempts: [r],
    note: r.responseCode === "4045408"
      ? "Invalid Merchant: inspect merchant/division/shop IDs and DANA API Logs; do not guess IDs."
      : null
  };
}

// ---------------------------------------------------------------------------
// Skenario 2 — 4005402 (missing/invalid mandatory field)
// Perilaku skrip UAT resmi: signature tetap valid (dihitung dengan timestamp nyata),
// tetapi header X-TIMESTAMP dikosongkan / tidak dikirim.
// ---------------------------------------------------------------------------
async function scenarioMandatoryField(ctx) {
  const attempts = [];
  const modes = [
    { mode: "omit", label: "header X-TIMESTAMP tidak dikirim" },
    { mode: "empty", label: "header X-TIMESTAMP kosong (pola skrip Node resmi)" }
  ];
  for (const m of modes) {
    const r = await ctx.send({ label: m.label, body: ctx.base(), timestampMode: m.mode });
    attempts.push(r);
    if (r.responseCode === EXPECTED.MANDATORY) return { passed: true, attempts: attempts };
    await ctx.pause();
  }
  return { passed: false, attempts: attempts };
}

// ---------------------------------------------------------------------------
// Skenario 3 — 4005401 (invalid field format) via kandidat FORMAT_CANDIDATES
// ---------------------------------------------------------------------------
async function scenarioInvalidFormat(ctx) {
  const attempts = [];
  const limit = Math.max(1, Number(ctx.args.maxProbe) || FORMAT_CANDIDATES.length);
  const candidates = FORMAT_CANDIDATES.slice(0, limit);
  for (const cand of candidates) {
    const r = await ctx.send({
      label: cand.label,
      body: ctx.base(cand.overrides(ctx)),
      timestampMode: cand.timestampMode || "normal"
    });
    attempts.push(r);
    if (r.responseCode === EXPECTED.FORMAT) return { passed: true, attempts: attempts };
    await ctx.pause();
  }
  await ctx.pause();
  return { passed: false, attempts: attempts };
}

// Inconsistent request: preserve every field except amount and use a fresh external ID.
async function scenarioInconsistent(ctx) {
  const original = ctx.base();
  const first = await ctx.send({ label: "inconsistent prerequisite: valid order", body: original });
  const attempts = [first];
  if (first.responseCode !== EXPECTED.SUCCESS) {
    return { passed: false, attempts, note: "Blocked: initial order must return 2005400 before testing inconsistency." };
  }
  await ctx.pause();
  const changed = structuredClone(original);
  changed.amount.value = (ctx.amount + 1000).toFixed(2);
  const second = await ctx.send({ label: "same partnerReferenceNo, different amount", body: changed });
  attempts.push(second);
  return { passed: second.responseCode === EXPECTED.INCONSISTENT, attempts };
}

async function scenarioUnauthorized(ctx) {
  const r = await ctx.send({ label: "invalid X-SIGNATURE", body: ctx.base(), signatureOverride: FAKE_SIGNATURE });
  return { passed: r.responseCode === EXPECTED.UNAUTHORIZED, attempts: [r] };
}

const SCENARIOS = {
  [EXPECTED.SUCCESS]: scenarioSuccess,
  [EXPECTED.MANDATORY]: scenarioMandatoryField,
  [EXPECTED.FORMAT]: scenarioInvalidFormat,
  [EXPECTED.INCONSISTENT]: scenarioInconsistent,
  [EXPECTED.UNAUTHORIZED]: scenarioUnauthorized
};
const DEFAULT_SCENARIOS = [EXPECTED.MANDATORY, EXPECTED.FORMAT, EXPECTED.INCONSISTENT, EXPECTED.UNAUTHORIZED];

function createContext(args, env) {
  const environment = String(env.DANA_ENV || "sandbox").trim().toLowerCase();
  if (environment !== "sandbox") throw new Error("UAT runner is sandbox-only; set DANA_ENV=sandbox.");
  const origin = String(env.DANA_ORIGIN || "https://customlink.pages.dev").trim().replace(/\/+$/, "");
  const notifyUrl = String(env.NOTIFY_URL || DEFAULT_NOTIFY_URL).trim();
  for (const url of [origin, notifyUrl]) {
    if (new URL(url).protocol !== "https:") throw new Error("Origin and notification URL must use HTTPS.");
  }
  const ctx = {
    args, host: DANA_HOST.sandbox, origin, notifyUrl,
    merchantId: String(env.MERCHANT_ID || "").trim(),
    partnerId: String(env.X_PARTNER_ID || env.CLIENT_ID || "").trim(),
    subMerchantId: String(env.DANA_DIVISION_ID ?? env.SUB_MERCHANT_ID ?? "").trim(),
    externalStoreId: String(env.EXTERNAL_STORE_ID || "").trim(),
    channelId: resolveChannelId(env), amount: args.amount,
    xDebug: String(env.DANA_X_DEBUG ?? "true").toLowerCase() === "true",
    privateKeyPem: "",
    newReferenceNo: () => "UAT-" + randomExternalId(),
    amountStr: () => args.amount.toFixed(2),
    pause: () => sleep(args.delay)
  };
  ctx.base = (overrides) => buildBody(ctx, overrides);
  let lastRequestFinished = 0;
  ctx.send = async (opts) => {
    const wait = args.delay - (Date.now() - lastRequestFinished);
    if (wait > 0) await sleep(wait);
    const result = await sendCreateOrder(ctx, opts);
    lastRequestFinished = Date.now();
    if (!args.json) console.log("  " + opts.label + ": " + describeResult(result));
    return result;
  };
  return ctx;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return; }
  const selected = args.only || DEFAULT_SCENARIOS;
  const env = loadRawEnv(args);
  const ctx = createContext(args, env);
  if (args.dryRun) {
    const plan = {
      dryRun: true, endpoint: ctx.host + CREATE_ORDER_PATH, delayMs: args.delay,
      scenarios: selected.map((code) => ({ code, meaning: MEANING[code] })),
      sampleBody: ctx.base(),
      formatCandidates: FORMAT_CANDIDATES.slice(0, args.maxProbe).map((c) => c.label),
      note: "No network requests or key loading. 4045418 requires a successful initial order. Dashboard completion must be checked manually."
    };
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!ctx.merchantId || !ctx.partnerId) throw new Error("MERCHANT_ID and CLIENT_ID/X_PARTNER_ID are required.");
  if (ctx.merchantId.length > 64 || ctx.partnerId.length > 36) throw new Error("Merchant/partner identifier exceeds DANA limits.");
  const key = resolvePrivateKey(env);
  if (!key.pem) throw new Error("No local sandbox private key. Set DANA_PRIVATE_KEY or supply --key-file with the sandbox key registered at DANA.");
  ctx.privateKeyPem = key.pem;
  try { await signSnapB2B(ctx.privateKeyPem, snapTimestampGmt7(0), "{}"); }
  catch { throw new Error("Private key validation failed: use a valid RSA PKCS#8 sandbox key. No requests sent."); }
  const results = [];
  for (const code of selected) {
    if (!args.json) console.log("\nScenario " + code + " (" + MEANING[code] + ")");
    const result = await SCENARIOS[code](ctx);
    results.push({ expectedCode: code, ...result });
  }
  const report = {
    environment: "sandbox", completedAt: new Date().toISOString(),
    passed: results.filter((r) => r.passed).length, total: results.length, results,
    dashboardVerified: false,
    note: "API assertions are not proof of portal completion. Check Merchant Portal > Mandatory API Testing and API Logs."
  };
  console.log(JSON.stringify(report, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

export { parseArgs, parseKeyValueFile, normalizePrivateKeyPem, signSnapB2B, snapTimestampGmt7,
  randomExternalId, createContext, sendCreateOrder, scenarioInconsistent, SCENARIOS, main };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("[ERROR] " + err.message); process.exitCode = 1; });
}

#!/usr/bin/env node
/*
 * DANA sandbox Finish Notify UAT runner (Node 18+; built-in modules only).
 * Mengejar 3/3 pada "General Payment finish notify POST /v1.0/debit/notify":
 *   1. success (00 = Success)   amount 11011.00 + pay VA sandbox
 *   2. error (500 dari partner)  amount 11012.00 + pay VA sandbox
 *   3. expired (05 = Cancelled)  amount 11013.00, validUpTo +135s, TANPA pay
 *
 * Pola resmi dana-id/uat-script test/node/payment_gateway/finish_notify_test.ts:
 * merchant TIDAK menembak /v1.0/debit/notify. DANA yang mengirim notify ke URL
 * NOTIFICATION milik order setelah dibayar/kedaluwarsa. Mock resmi n8n membalas
 * berbeda per nominal sehingga dashboard menandai 3 skenario selesai.
 * Nominal 11011/11012/11013 JANGAN diubah.
 *
 * Script ini TIDAK memakai NOTIFY_URL aplikasi (/api/webhook/gapura).
 * Assertion lokal BUKAN bukti portal; cek Mandatory API Testing + API Logs manual.
 * Sandbox-only. Jangan commit key.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseKeyValueFile, normalizePrivateKeyPem, signSnapB2B,
  snapTimestampGmt7, randomExternalId,
} from "./run_uat.mjs";

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CREATE_ORDER_PATH = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";
const DANA_HOST = "https://api.sandbox.dana.id";
const NOTIFY_MOCK_URL = "https://n8n.automation.dana.id/webhook/3676a08f-b06e-416c-b6cd-bea04f71c4d5";
const SANDBOX_TOOLS_URL = "https://dashboard-sandbox.dana.id/merchant-portal-app/api/sandbox-tools/execute";
const TRANSFER_VA_ENDPOINT = "/v1.0/transfer-va/payment.htm";

const SCENARIOS = [
  { id: "success", label: "Acknowledge Transaction Success Notify (00)", amount: "11011.00", upTo: 360, payVA: true },
  { id: "error", label: "Internal Server Error Response from Partner", amount: "11012.00", upTo: 360, payVA: true },
  { id: "expired", label: "Acknowledge Transaction Closed/Expired Notify (05)", amount: "11013.00", upTo: 135, payVA: false },
];
function usage() {
  return [
    "Penggunaan: node run_finish_notify.mjs [opsi]",
    "  --dry-run         Rencana tanpa network/kunci.",
    "  --only <id[,id]>  success,error,expired (default ketiganya).",
    "  --delay <ms>      Jeda antar request (default 1500).",
    "  --key-file <path> PEM private key PKCS#8.",
    "  --env-file <path> Berkas KEY=VALUE tambahan (boleh diulang).",
    "  --json            Laporan akhir JSON.",
    "  --help, -h        Bantuan.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { dryRun: false, only: null, delay: 1500, json: false, help: false, keyFile: null, envFiles: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("Missing value for " + a);
      return v;
    };
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only = String(next()).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--delay") args.delay = Number(next());
    else if (a === "--key-file") args.keyFile = path.resolve(next());
    else if (a === "--env-file") args.envFiles.push(path.resolve(next()));
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.trim()) throw new Error("Unknown argument: " + a);
  }
  if (!Number.isInteger(args.delay) || args.delay < 0 || args.delay > 60000) throw new Error("--delay 0..60000.");
  if (args.only && (!args.only.length || args.only.some((id) => !SCENARIOS.some((s) => s.id === id)))) {
    throw new Error("--only must be subset of success,error,expired.");
  }
  if (args.only) args.only = [...new Set(args.only)];
  return args;
}

function parseWranglerVars(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  let inVars = false;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) { inVars = t === "[vars]"; continue; }
    if (!inVars || !t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadRawEnv(args) {
  const files = [
    path.join(REPO_ROOT, "env.local"), path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".dev.vars"), path.join(REPO_ROOT, "worker", ".dev.vars"),
  ].concat(args.envFiles || []);
  const merged = Object.assign({}, parseWranglerVars(path.join(REPO_ROOT, "worker", "wrangler.toml")));
  for (const f of args.envFiles || []) if (!existsSync(f)) throw new Error("--env-file not found: " + f);
  for (const f of files) Object.assign(merged, parseKeyValueFile(f));
  for (const k of ["DANA_PRIVATE_KEY", "MERCHANT_ID", "CLIENT_ID", "X_PARTNER_ID",
    "DANA_ORIGIN", "SUB_MERCHANT_ID", "DANA_DIVISION_ID", "EXTERNAL_STORE_ID",
    "DANA_CHANNEL_ID", "DANA_ENV", "DANA_X_DEBUG"]) {
    if (process.env[k]) merged[k] = process.env[k];
  }
  if (args.keyFile) merged.__KEY_FILE = args.keyFile;
  return merged;
}

function resolvePrivateKey(env) {
  if (env.__KEY_FILE) {
    if (!existsSync(env.__KEY_FILE)) throw new Error("--key-file tidak ditemukan: " + env.__KEY_FILE);
    return normalizePrivateKeyPem(readFileSync(env.__KEY_FILE, "utf8"));
  }
  if (env.DANA_PRIVATE_KEY) return normalizePrivateKeyPem(env.DANA_PRIVATE_KEY);
  return "";
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }


function buildBody(ctx, sc) {
  return {
    partnerReferenceNo: randomUUID(),
    merchantId: ctx.merchantId,
    amount: { value: sc.amount, currency: "IDR" },
    validUpTo: snapTimestampGmt7(sc.upTo),
    urlParams: [
      { url: ctx.origin + "/", type: "PAY_RETURN", isDeeplink: "N" },
      { url: NOTIFY_MOCK_URL, type: "NOTIFICATION", isDeeplink: "N" },
    ],
    payOptionDetails: [{
      payMethod: "VIRTUAL_ACCOUNT", payOption: "VIRTUAL_ACCOUNT_CIMB",
      transAmount: { value: sc.amount, currency: "IDR" },
    }],
    additionalInfo: {
      mcc: "5734",
      envInfo: { sourcePlatform: "IPG", terminalType: "SYSTEM" },
      order: { orderTitle: "UAT Finish Notify " + sc.id, scenario: "FINISH_NOTIFY" },
    },
    ...(ctx.subMerchantId ? { subMerchantId: ctx.subMerchantId } : {}),
    ...(ctx.externalStoreId ? { externalStoreId: ctx.externalStoreId } : {}),
  };
}

async function sendCreateOrder(ctx, body, label) {
  const bodyStr = JSON.stringify(body);
  const ts = snapTimestampGmt7(0);
  const sig = await signSnapB2B(ctx.privateKeyPem, ts, bodyStr);
  const headers = {
    "Content-Type": "application/json", "X-PARTNER-ID": ctx.partnerId,
    "X-EXTERNAL-ID": randomExternalId(), "CHANNEL-ID": ctx.channelId,
    ORIGIN: ctx.origin, "X-SIGNATURE": sig, "X-TIMESTAMP": ts,
  };
  if (ctx.xDebug) headers["X-Debug-Mode"] = "true";
  const out = { label, requestBody: body, httpStatus: null, responseCode: null,
    responseMessage: null, debugMessage: null, paymentCode: null, networkError: null };
  try {
    const res = await fetch(DANA_HOST + CREATE_ORDER_PATH, {
      method: "POST", headers, body: bodyStr,
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    out.httpStatus = res.status;
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (data) {
      out.responseCode = data.responseCode || null;
      out.responseMessage = data.responseMessage || null;
      out.debugMessage = (data.additionalInfo && data.additionalInfo.debugMessage) || null;
      out.paymentCode = (data.additionalInfo && data.additionalInfo.paymentCode) || null;
      out.rawResponse = data;
    }
  } catch (e) { out.networkError = (e && e.message) || String(e); }
  return out;
}

async function payVA(paymentCode) {
  const res = await fetch(SANDBOX_TOOLS_URL, {
    method: "POST",
    headers: {
      accept: "application/json", "content-type": "application/json",
      origin: "https://dashboard.dana.id", referer: "https://dashboard.dana.id/",
    },
    body: JSON.stringify({ urlEndpoint: TRANSFER_VA_ENDPOINT, requestBody: { virtualAccountNo: paymentCode } }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("pay VA gagal: status=" + res.status + " body=" + text.slice(0, 300));
  return text.slice(0, 300);
}
async function runScenario(ctx, sc) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = buildBody(ctx, sc);
    const created = await sendCreateOrder(ctx, body, sc.id + " create-order #" + attempt);
    attempts.push({ step: "create-order", attempt, ...created });
    if (created.networkError) { await sleep(2000); continue; }
    if (created.responseCode === "5005400" || created.responseCode === "5005401") {
      await sleep(2000); continue;
    }
    if (created.responseCode !== "2005400") {
      return { id: sc.id, label: sc.label, passed: false, attempts,
        note: "Create order harus 2005400. Lihat responseCode/debugMessage." };
    }
    if (!sc.payVA) {
      return { id: sc.id, label: sc.label, passed: true, attempts,
        note: "Order expired dibuat. JANGAN bayar. Tunggu ~3 mnt agar DANA kirim notify 05 ke mock." };
    }
    if (!created.paymentCode) {
      return { id: sc.id, label: sc.label, passed: false, attempts, note: "paymentCode hilang." };
    }
    try {
      const pr = await payVA(created.paymentCode);
      attempts.push({ step: "pay-va", result: pr });
      return { id: sc.id, label: sc.label, passed: true, attempts,
        note: "VA dibayar; DANA kirim notify ke mock n8n. Tunggu 30-60 dtk lalu cek dashboard." };
    } catch (e) {
      attempts.push({ step: "pay-va", error: (e && e.message) || String(e) });
      return { id: sc.id, label: sc.label, passed: false, attempts, note: "Pay VA gagal." };
    }
  }
  return { id: sc.id, label: sc.label, passed: false, attempts, note: "Gagal 3x." };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return; }
  const env = loadRawEnv(args);
  if (String(env.DANA_ENV || "sandbox").trim().toLowerCase() !== "sandbox") {
    throw new Error("Sandbox-only; set DANA_ENV=sandbox.");
  }
  const rawCh = String(env.DANA_CHANNEL_ID || "").trim();
  const ctx = {
    origin: String(env.DANA_ORIGIN || "https://customlink.pages.dev").trim().replace(/\/+$/, ""),
    merchantId: String(env.MERCHANT_ID || "").trim(),
    partnerId: String(env.X_PARTNER_ID || env.CLIENT_ID || "").trim(),
    subMerchantId: String(env.DANA_DIVISION_ID ?? env.SUB_MERCHANT_ID ?? "").trim(),
    externalStoreId: String(env.EXTERNAL_STORE_ID || "").trim(),
    channelId: rawCh && rawCh.length <= 5 ? rawCh : "95221",
    xDebug: String(env.DANA_X_DEBUG ?? "true").toLowerCase() === "true",
    delay: args.delay, privateKeyPem: "",
  };
  const selected = (args.only || SCENARIOS.map((s) => s.id)).map((id) => SCENARIOS.find((s) => s.id === id));
  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, endpoint: DANA_HOST + CREATE_ORDER_PATH,
      notifyMock: NOTIFY_MOCK_URL,
      scenarios: selected.map((s) => ({ id: s.id, label: s.label, amount: s.amount, payVA: s.payVA })),
      note: "Nominal 11011/11012/11013 wajib. Tanpa network/kunci." }, null, 2));
    return;
  }
  if (!ctx.merchantId || !ctx.partnerId) throw new Error("MERCHANT_ID dan CLIENT_ID/X_PARTNER_ID wajib.");
  ctx.privateKeyPem = resolvePrivateKey(env);
  if (!ctx.privateKeyPem) throw new Error("Private key sandbox tidak ditemukan (DANA_PRIVATE_KEY/--key-file).");
  await signSnapB2B(ctx.privateKeyPem, snapTimestampGmt7(0), "{}");
  const results = [];
  for (const sc of selected) {
    if (!args.json) console.log("\n[" + sc.id + "] " + sc.label + " amount=" + sc.amount);
    const r = await runScenario(ctx, sc);
    if (!args.json) console.log("  -> " + (r.passed ? "OK" : "GAGAL") + " - " + (r.note || ""));
    results.push(r);
    await sleep(ctx.delay);
  }
  const report = { environment: "sandbox", completedAt: new Date().toISOString(),
    notifyMock: NOTIFY_MOCK_URL,
    passed: results.filter((r) => r.passed).length, total: results.length, results,
    dashboardVerified: false,
    note: "Lokal OK != dashboard 3/3. Cek dashboard.dana.id > Sandbox > Testing Scenarios > Payment Gateway > General Payment finish notify + API Logs." };
  console.log(JSON.stringify(report, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

export { parseArgs, buildBody, payVA, SCENARIOS, main };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[ERROR] " + (e && e.message ? e.message : e)); process.exitCode = 1; });
}


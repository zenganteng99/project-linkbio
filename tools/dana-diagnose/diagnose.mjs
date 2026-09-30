#!/usr/bin/env node
/*
 * diagnose.mjs — CLI diagnosa error pembayaran DANA (Node >= 18)
 * ---------------------------------------------------------------------------
 * Tool ini TIDAK mengubah kode produksi. Ia mengirim beberapa VARIAN payload ke
 * DANA (sandbox/production sesuai env) untuk mencari tahu varian mana yang
 * ditolak dan mana yang diterima, sehingga akar masalah `4045408 Invalid
 * Merchant` bisa diisolasi sebelum menyentuh worker/worker.js.
 *
 * Contoh pemakaian (PowerShell):
 *   node tools/dana-diagnose/diagnose.mjs --self-test
 *   node tools/dana-diagnose/diagnose.mjs --dry-run
 *   node tools/dana-diagnose/diagnose.mjs --live --variant baseline,no-submerchant,clean
 *
 * Aman: default = DRY RUN (tidak mengirim apa pun). Kirim request nyata hanya
 * kalau memakai flag --live.
 */
import { existsSync, readFileSync } from "node:fs";
import { webcrypto, generateKeyPairSync, createVerify, createPublicKey } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

function usage() {
  return [
    "Penggunaan: node diagnose.mjs [opsi]",
    "",
    "Opsi:",
    "  --live                  Kirim request NYATA ke DANA (default: dry-run).",
    "  --dry-run               Hanya tampilkan request yang akan dikirim.",
    "  --variant <id[,id]>     baseline | no-submerchant | division-id | registered-origin |",
    "                          spec-timestamp | short-channel | clean | all (default: all)",
    "  --amount <angka>        Nominal uji (default 285000).",
    "  --package <nama>        orderTitle paket (default \"Starter Package\").",
    "  --delay <ms>            Jeda antar request (default 1200).",
    "  --env-file <path>       File KEY=VALUE tambahan (default: <folder>/env.local).",
    "  --ephemeral-key         Pakai kunci RSA sekali pakai (uji jalur signature saja).",
    "  --json                  Cetak hasil mentah sebagai JSON.",
    "  --self-test             Uji internal offline (tanpa jaringan & kredensial).",
    "  --help                  Tampilkan bantuan ini.",
    "",
    "Env yang dibaca: DANA_ENV, MERCHANT_ID, CLIENT_ID (atau X_PARTNER_ID),",
    "  DANA_PRIVATE_KEY atau DANA_PRIVATE_KEY_PATH, DANA_ORIGIN,",
    "  DANA_DIVISION_ID / SUB_MERCHANT_ID (External Division ID dari tab Division),",
    "  EXTERNAL_STORE_ID (External Shop ID, opsional), DANA_CHANNEL_ID (1-5 karakter),",
    "  DANA_MCC, SUPABASE_SERVICE_ROLE_KEY (opsional)."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    variant: "all", amount: 285000, packageName: "Starter Package", delay: 1200,
    live: false, dryRun: false, json: false, selfTest: false, ephemeralKey: false,
    envFile: path.join(SCRIPT_DIR, "env.local")
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--live") args.live = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--variant") args.variant = next();
    else if (a === "--amount") args.amount = Number(next());
    else if (a === "--package") args.packageName = next();
    else if (a === "--delay") args.delay = Number(next());
    else if (a === "--env-file") args.envFile = path.resolve(next());
    else if (a === "--ephemeral-key") args.ephemeralKey = true;
    else if (a === "--json") args.json = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a.trim()) console.warn("[WARN] Argumen tidak dikenal: " + a);
  }
  return args;
}

// Parser .env sederhana (tanpa dependency): KEY=VALUE, abaikan komentar/blanks.
export function parseEnvFile(filePath) {
  const out = {};
  if (!filePath || !existsSync(filePath)) return out;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveEnv(args) {
  const fromFile = parseEnvFile(args.envFile);
  const repoEnv = parseEnvFile(path.join(REPO_ROOT, ".env.local"));
  const merged = Object.assign({}, repoEnv, fromFile);
  for (const key of Object.keys(merged)) {
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = merged[key];
  }
  // Dukung private key dari file (lebih aman daripada menempel PEM di env/shell).
  const pemFile = process.env.DANA_PRIVATE_KEY_PATH || process.env.DANA_PRIVATE_KEY_FILE;
  if (pemFile && existsSync(pemFile)) {
    process.env.DANA_PRIVATE_KEY = readFileSync(pemFile, "utf8");
    console.log("[INFO] DANA_PRIVATE_KEY dibaca dari file: " + pemFile);
  } else if (pemFile) {
    console.warn("[WARN] File private key tidak ditemukan: " + pemFile);
  }
  // PEM yang ditempel di satu baris sering memakai escape \n.
  if (process.env.DANA_PRIVATE_KEY && process.env.DANA_PRIVATE_KEY.includes("\\n") &&
      !process.env.DANA_PRIVATE_KEY.includes("\n")) {
    process.env.DANA_PRIVATE_KEY = process.env.DANA_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  return merged;
}

function ephemeralKeyPem() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), keyObject: privateKey };
}

function line(char, n) { return (char || "-").repeat(n || 78); }
function statusTag(status) {
  if (status === "ok") return "[OK]  ";
  if (status === "warn") return "[WARN]";
  return "[FAIL]";
}

function printPreflight(pre) {
  console.log(line("="));
  console.log("PREFLIGHT - konformitas konfigurasi terhadap spesifikasi DANA");
  console.log(line("="));
  console.log("Environment : " + pre.danaEnv + "  (" + pre.host + ")");
  console.log("");
  for (const c of pre.checks) {
    console.log(statusTag(c.status) + " " + c.name);
    console.log("        harapan : " + c.expected);
    console.log("        aktual  : " + c.actual);
    if (c.hint) console.log("        catatan : " + c.hint);
  }
  console.log("");
}

function printConfig(cfg) {
  console.log(line("="));
  console.log("KONFIGURASI YANG DIPAKAI");
  console.log(line("="));
  for (const k of Object.keys(cfg)) console.log("  " + String(k).padEnd(24) + ": " + cfg[k]);
  console.log("");
}

function printResult(r) {
  console.log(line("-"));
  if (r.skipped) {
    console.log("[SKIP] " + r.id + " - " + r.label);
    console.log("       " + r.note);
    return;
  }
  if (r.dryRun) {
    console.log("[DRY ] " + r.id + " - " + r.label);
    console.log("       POST " + r.request.endpoint);
    for (const h of Object.keys(r.request.headers)) {
      console.log("       " + h + ": " + r.request.headers[h]);
    }
    console.log("       body: " + JSON.stringify(r.request.body));
    return;
  }
  console.log((r.ok ? "[PASS] " : "[FAIL] ") + r.id + " - " + r.label);
  console.log("       HTTP " + r.httpStatus + " | responseCode " + (r.responseCode || "-") +
    (r.meaning ? " (" + r.meaning + ")" : "") + " | " + r.durationMs + " ms");
  if (r.responseMessage) console.log("       responseMessage : " + r.responseMessage);
  if (r.debugMessage) console.log("       debugMessage    : " + r.debugMessage);
  if (r.networkError) console.log("       networkError    : " + r.networkError);
  console.log("       ORIGIN dikirim  : " + r.request.headers.ORIGIN);
  console.log("       X-TIMESTAMP     : " + r.request.headers["X-TIMESTAMP"]);
  console.log("       CHANNEL-ID      : " + r.request.headers["CHANNEL-ID"] +
    " (" + String(r.request.headers["CHANNEL-ID"] || "").length + " char)");
  console.log("       subMerchantId   : " + (r.request.body.subMerchantId || "(tidak dikirim)"));
  if (r.raw) console.log("       body mentah     : " + String(r.raw).replace(/\s+/g, " ").slice(0, 600));
}

function printVerdict(v) {
  console.log("");
  console.log(line("="));
  console.log("KESIMPULAN OTOMATIS");
  console.log(line("="));
  if (v.indeterminate) console.log("  (belum bisa disimpulkan)");
  for (const f of v.findings || []) console.log("  - " + f);
  if ((v.nextSteps || []).length) {
    console.log("");
    console.log("  Langkah berikutnya:");
    (v.nextSteps || []).forEach((s, i) => console.log("    " + (i + 1) + ". " + s));
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// SELF-TEST: memvalidasi seluruh jalur logika secara offline (tanpa jaringan).
// ---------------------------------------------------------------------------
async function selfTest(core) {
  let pass = 0;
  let fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log("[OK]  " + name); }
    else { fail++; console.log("[FAIL] " + name + (detail ? " - " + detail : "")); }
  };

  console.log(line("="));
  console.log("SELF-TEST OFFLINE (tanpa jaringan, tanpa kredensial)");
  console.log(line("="));

  // 1. Timestamp
  const now = new Date(Date.UTC(2026, 8, 30, 4, 5, 6));
  const gmt7 = core.snapTimestampGmt7(now);
  const utc = core.snapTimestampUtc(now);
  check("snapTimestampGmt7 format YYYY-MM-DDTHH:mm:ss+07:00", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/.test(gmt7), gmt7);
  check("snapTimestampGmt7 panjang 25 karakter (spesifikasi DANA)", gmt7.length === 25, String(gmt7.length));
  check("snapTimestampGmt7 = waktu UTC + 7 jam", gmt7 === "2026-09-30T11:05:06+07:00", gmt7);
  check("snapTimestampUtc (perilaku worker saat ini) berakhir +00:00", utc.endsWith("+00:00"), utc);

  // 2. Normalisasi kunci
  const bare = core.normalizePrivateKeyPem("ABCD".repeat(32));
  check("normalizePrivateKeyPem membungkus base64 menjadi PEM PKCS#8",
    bare.indexOf("-----BEGIN PRIVATE KEY-----") === 0 && bare.endsWith("-----END PRIVATE KEY-----"), bare.slice(0, 30));

  // 3. Tanda tangan: buat kunci sekali pakai, tanda tangani, lalu VERIFIKASI ulang
  const { pem, keyObject } = ephemeralKeyPem();
  const body = JSON.stringify({ partnerReferenceNo: "DIAG-TEST", amount: { value: "1.00", currency: "IDR" } });
  const ts = core.snapTimestampGmt7(now);
  const signature = await core.snapB2BSignature(core.CREATE_ORDER_PATH, body, pem, ts);
  const hash = await core.sha256Hex(body);
  const stringToSign = "POST:" + core.CREATE_ORDER_PATH + ":" + hash + ":" + ts;
  const publicPem = createPublicKey(keyObject).export({ type: "spki", format: "pem" }).toString();
  check("X-SIGNATURE valid menurut verifikasi RSA-SHA256",
    createVerify("RSA-SHA256").update(stringToSign).verify(publicPem, signature, "base64"));
  check("X-SIGNATURE gagal bila stringToSign diubah (anti-tamper)",
    createVerify("RSA-SHA256").update(stringToSign.replace("DIAG-TEST", "DIAG-HACK")).verify(publicPem, signature, "base64") === false);
  check("stringToSign memakai endpoint path, bukan URL penuh",
    stringToSign.indexOf("POST:" + core.CREATE_ORDER_PATH + ":") === 0, stringToSign.slice(0, 60));

  // 4. Body request
  const cfg = core.readConfig({
    DANA_ENV: "sandbox", MERCHANT_ID: "216620000000000000000", CLIENT_ID: "2026092618040865582354",
    DANA_PRIVATE_KEY: pem, DANA_ORIGIN: "https://customlink.pages.dev"
  });
  const baseOpts = { orderId: "DIAG-1", amount: 285000, packageName: "Starter Package" };
  const withSub = core.buildRequestBody(cfg, Object.assign({}, baseOpts, { includeSubMerchantId: true }));
  const withoutSub = core.buildRequestBody(cfg, Object.assign({}, baseOpts, { includeSubMerchantId: false }));
  check("body baseline memuat subMerchantId (seperti worker.js:153)",
    withSub.subMerchantId === core.WORKER_DEFAULTS.hardcodedSubMerchantId, JSON.stringify(withSub.subMerchantId));
  check("body varian uji dapat menghilangkan subMerchantId", withoutSub.subMerchantId === undefined);
  check("amount diformat 2 desimal (285000.00)", withSub.amount.value === "285000.00", withSub.amount.value);
  check("scenario order = REDIRECT", withSub.additionalInfo.order.scenario === "REDIRECT");
  check("urlParams berisi PAY_RETURN + NOTIFICATION", withSub.urlParams.length === 2 && withSub.urlParams[1].type === "NOTIFICATION");
  const withDivision = core.buildRequestBody(cfg, Object.assign({}, baseOpts, {
    includeSubMerchantId: true, subMerchantIdValue: core.WORKER_DEFAULTS.externalDivisionId
  }));
  check("varian division-id memakai External Division ID (bukan Shop ID)",
    withDivision.subMerchantId === core.WORKER_DEFAULTS.externalDivisionId, String(withDivision.subMerchantId));
  const withBlankSub = core.buildRequestBody(cfg, Object.assign({}, baseOpts, {
    includeSubMerchantId: true, subMerchantIdValue: ""
  }));
  check("subMerchantId kosong tidak dikirim ke DANA", withBlankSub.subMerchantId === undefined);
  const withStore = core.buildRequestBody(cfg, Object.assign({}, baseOpts, {
    includeSubMerchantId: true, subMerchantIdValue: "", externalStoreIdValue: core.WORKER_DEFAULTS.externalShopId
  }));
  check("externalStoreId hanya dikirim bila diisi", withStore.externalStoreId === core.WORKER_DEFAULTS.externalShopId);

  // 5. Preflight
  const badPre = core.preflight({});
  check("preflight menandai konfigurasi kosong sebagai tidak OK", badPre.ok === false);
  check("preflight mendeteksi MERCHANT_ID hilang", badPre.checks.some((c) => c.name === "MERCHANT_ID" && c.status === "fail"));
  const goodPre = core.preflight({
    DANA_ENV: "sandbox", MERCHANT_ID: "216620000000000000000", CLIENT_ID: "2026092618040865582354",
    DANA_PRIVATE_KEY: pem, DANA_ORIGIN: "https://customlink.pages.dev"
  });
  check("preflight lolos untuk konfigurasi lengkap", goodPre.ok === true,
    JSON.stringify(goodPre.checks.filter((c) => c.status === "fail")));
  check("preflight memperingatkan CHANNEL-ID > 5 karakter",
    goodPre.checks.some((c) => c.name.indexOf("CHANNEL-ID") === 0 && c.status === "warn"));
  check("preflight memperingatkan ORIGIN masih origin Worker",
    goodPre.checks.some((c) => c.name.indexOf("ORIGIN") === 0 && c.status === "warn"));

  // 6. Pemilihan varian
  check("selectVariants('no-submerchant') mengembalikan tepat 1 varian", core.selectVariants(cfg, "no-submerchant").length === 1);
  check("selectVariants('all') mengembalikan 7 varian", core.selectVariants(cfg, "all").length === 7);
  check("selectVariants('division-id') mengembalikan tepat 1 varian", core.selectVariants(cfg, "division-id").length === 1);
  const divisionVariant = core.selectVariants(cfg, "division-id")[0];
  check("varian division-id = External Division ID + GMT+7 + CHANNEL-ID <= 5 karakter",
    divisionVariant.subMerchantIdValue === core.WORKER_DEFAULTS.externalDivisionId &&
    divisionVariant.timestampMode === "gmt7" && divisionVariant.channelId.length <= 5,
    JSON.stringify({ sub: divisionVariant.subMerchantIdValue, ch: divisionVariant.channelId }));
  check("varian baseline TETAP memakai Shop ID (mereproduksi bug worker lama)",
    core.selectVariants(cfg, "baseline")[0].subMerchantIdValue === core.WORKER_DEFAULTS.hardcodedSubMerchantId);
  check("varian perbaikan memakai CHANNEL-ID <= 5 karakter",
    ["division-id", "short-channel", "clean"].every((id) => {
      const v = core.selectVariants(cfg, id)[0];
      return Boolean(v) && String(v.channelId).length <= 5;
    }));

  // 7. Verdict / diagnosis otomatis
  const dummy = { request: { headers: {}, body: {} } };
  const v1 = core.buildVerdict([
    Object.assign({ id: "baseline", ok: false, responseCode: "4045408", httpStatus: 404 }, dummy),
    Object.assign({ id: "no-submerchant", ok: true, responseCode: "2005400", httpStatus: 200 }, dummy)
  ]);
  check("verdict mendeteksi hipotesis H3 (subMerchantId)",
    v1.findings.join(" ").indexOf("worker.js:153") >= 0, v1.findings.join(" | "));
  const v2 = core.buildVerdict([
    Object.assign({ id: "baseline", ok: false, responseCode: "4045408", httpStatus: 404 }, dummy),
    Object.assign({ id: "clean", ok: false, responseCode: "4045408", httpStatus: 404 }, dummy)
  ]);
  check("verdict menandai 'semua varian 4045408' sebagai masalah merchant", v2.allMerchantError === true);
  check("verdict memberi langkah cek dashboard.dana.id",
    v2.nextSteps.join(" ").indexOf("dashboard.dana.id") >= 0);
  const v3 = core.buildVerdict([
    Object.assign({ id: "baseline", ok: false, responseCode: "4015400", httpStatus: 401 }, dummy)
  ]);
  check("verdict mengenali 4015400 sebagai masalah signature",
    v3.findings.join(" ").indexOf("4015400") >= 0);
  const v4 = core.buildVerdict([
    {
      id: "baseline", ok: false, responseCode: "4045408", httpStatus: 404,
      debugMessage: "DIVISION_NOT_EXIST:division not exist",
      request: {
        headers: {
          "CHANNEL-ID": "2026092618040865582354-SERVER",
          "X-TIMESTAMP": "2026-09-30T04:08:27+00:00",
          ORIGIN: "https://customlink-webhook.modernshopp.workers.dev"
        },
        body: { subMerchantId: core.WORKER_DEFAULTS.hardcodedSubMerchantId }
      }
    },
    { id: "division-id", ok: true, responseCode: "2005400", httpStatus: 200 }
  ]);
  const v4text = v4.findings.join(" | ");
  check("verdict mengenali DIVISION_NOT_EXIST + Shop ID sebagai subMerchantId",
    v4text.indexOf("DIVISION_NOT_EXIST") >= 0 && v4text.indexOf("External SHOP ID") >= 0, v4text);
  check("verdict menyebut External Division ID sebagai nilai yang benar",
    v4text.indexOf(core.WORKER_DEFAULTS.externalDivisionId) >= 0, v4text);
  check("verdict melaporkan pelanggaran spec baseline (CHANNEL-ID/timestamp/ORIGIN)",
    v4text.indexOf("Pelanggaran spesifikasi pada baseline") >= 0, v4text);

  // 8. Redaksi rahasia
  check("maskSecret tidak membocorkan nilai utuh",
    core.maskSecret("2026092618040865582354").indexOf("2026092618040865582354") < 0);
  check("RESPONSE_MEANINGS memuat arti 4045408",
    String(core.RESPONSE_MEANINGS["4045408"]).toLowerCase().indexOf("invalid merchant") >= 0);

  console.log("");
  console.log(line("="));
  console.log("SELF-TEST: " + pass + " lulus, " + fail + " gagal");
  console.log(line("="));
  return fail === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
// Nilai ini disalin dari worker/wrangler.toml (var publik, bukan rahasia) supaya
// preview DRY RUN memakai angka yang persis sama dengan produksi.
const WRANGLER_VARS = {
  MERCHANT_ID: "216620090026052421673",
  CLIENT_ID: "2026092618040865582354",
  DANA_ORIGIN: "https://customlink.pages.dev",
  SUB_MERCHANT_ID: "d5831d89",
  DANA_CHANNEL_ID: "95221"
};

function applyDryRunPlaceholders() {
  const notes = [];
  if (!process.env.MERCHANT_ID) { process.env.MERCHANT_ID = WRANGLER_VARS.MERCHANT_ID; notes.push("MERCHANT_ID = nilai wrangler.toml (preview)"); }
  if (!process.env.CLIENT_ID && !process.env.X_PARTNER_ID) { process.env.CLIENT_ID = WRANGLER_VARS.CLIENT_ID; notes.push("CLIENT_ID = nilai wrangler.toml (preview)"); }
  if (!process.env.DANA_ENV) process.env.DANA_ENV = "sandbox";
  if (!process.env.DANA_ORIGIN) process.env.DANA_ORIGIN = WRANGLER_VARS.DANA_ORIGIN;
  // DANA_DIVISION_ID sengaja diisi dari wrangler.toml; SUB_MERCHANT_ID dibiarkan apa adanya
  // supaya varian "baseline" tetap mereproduksi bug (Shop ID sebagai subMerchantId).
  if (!process.env.DANA_DIVISION_ID && !process.env.SUB_MERCHANT_ID) {
    process.env.DANA_DIVISION_ID = WRANGLER_VARS.SUB_MERCHANT_ID;
    notes.push("DANA_DIVISION_ID = External Division ID pada wrangler.toml (preview): " + WRANGLER_VARS.SUB_MERCHANT_ID);
  }
  if (!process.env.DANA_CHANNEL_ID) process.env.DANA_CHANNEL_ID = WRANGLER_VARS.DANA_CHANNEL_ID;
  if (!process.env.DANA_PRIVATE_KEY) {
    process.env.DANA_PRIVATE_KEY = ephemeralKeyPem().pem;
    notes.push("RSA key sekali pakai (hanya untuk menguji jalur X-SIGNATURE)");
  }
  return notes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const core = await import("./dana-diagnose-core.mjs");

  if (args.selfTest) return await selfTest(core);

  console.log(line("="));
  console.log("DIAGNOSA PEMBAYARAN DANA - customlink (tools/dana-diagnose)");
  console.log(line("="));
  const loaded = resolveEnv(args);
  if (!existsSync(args.envFile) && Object.keys(loaded).length === 0) {
    console.log("[INFO] Tidak ada file env di " + args.envFile + " - memakai variabel environment shell.");
  }
  if (args.ephemeralKey) {
    process.env.DANA_PRIVATE_KEY = ephemeralKeyPem().pem;
    console.log("[INFO] --ephemeral-key: memakai RSA 2048 sekali pakai " +
      "(X-SIGNATURE dijamin tidak dikenali DANA; berguna untuk menguji urutan validasi).");
  }

  const live = Boolean(args.live) && !args.dryRun;
  console.log("");
  if (!live) {
    console.log("[MODE] DRY RUN - tidak ada request yang dikirim ke DANA.");
    for (const n of applyDryRunPlaceholders()) console.log("       placeholder: " + n);
  } else {
    console.log("[MODE] LIVE - request NYATA dikirim ke DANA (gunakan akun sandbox!).");
  }

  if (live) {
    const missing = ["MERCHANT_ID"].filter((k) => !process.env[k]);
    if (!process.env.CLIENT_ID && !process.env.X_PARTNER_ID) missing.push("CLIENT_ID/X_PARTNER_ID");
    if (!process.env.DANA_PRIVATE_KEY) missing.push("DANA_PRIVATE_KEY");
    if (missing.length) {
      console.log("");
      console.log("[GAGAL] Kredensial belum lengkap untuk mode live. Kurang: " + missing.join(", "));
      console.log("        Isi file " + args.envFile + " (contoh: env.local.example) atau set variabel environment.");
      return 2;
    }
  }

  const report = await core.runDiagnostics(process.env, {
    variant: args.variant,
    amount: args.amount,
    packageName: args.packageName,
    delayMs: args.delay,
    dryRun: !live
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPreflight(report.preflight);
    printConfig(report.config);
    for (const r of report.results) printResult(r);
    if (report.dryRun) {
      console.log("");
      console.log("Selesai (dry-run). Jalankan dengan --live untuk mengirim ke DANA sandbox.");
      console.log("");
    } else {
      printVerdict(report.verdict);
    }
  }

  if (report.dryRun) return 0;
  const anyOk = (report.results || []).filter((r) => r.ok).length > 0;
  return anyOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[ERROR] " + ((err && err.stack) || err));
    process.exit(1);
  });

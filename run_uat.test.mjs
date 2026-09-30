import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, parseKeyValueFile, normalizePrivateKeyPem, signSnapB2B,
  snapTimestampGmt7, randomExternalId, createContext, sendCreateOrder, SCENARIOS } from "./run_uat.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const endpoint = "/payment-gateway/v1.0/debit/payment-host-to-host.htm";
const env = { MERCHANT_ID: "test-merchant", CLIENT_ID: "test-client", DANA_ENV: "sandbox" };
function context() {
  const ctx = createContext(parseArgs(["--delay", "0", "--json"]), env);
  ctx.privateKeyPem = pem;
  return ctx;
}

function verify(signature, timestamp, body) {
  const hash = createHash("sha256").update(body).digest("hex");
  return createVerify("RSA-SHA256").update("POST:" + endpoint + ":" + hash + ":" + timestamp)
    .verify(publicKey, signature, "base64");
}

test("strict CLI validation and selection", () => {
  for (const args of [["--only", "bad"], ["--only", ""], ["--delay", "-1"],
    ["--amount", "NaN"], ["--amount", "1.001"], ["--key-file"], ["--unknown"], ["--max-probe", "8"]]) {
    assert.throws(() => parseArgs(args));
  }
  assert.deepEqual(parseArgs(["--only", "4015400,4015400"]).only, ["4015400"]);
  assert.throws(() => createContext(parseArgs([]), { DANA_ENV: "production" }), /sandbox-only/);
});

test("GMT+7 timestamp, unique external IDs, and private-key normalization", () => {
  assert.match(snapTimestampGmt7(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+07:00$/);
  assert.ok(Math.abs(Date.parse(snapTimestampGmt7()) - Date.now()) < 1100);
  const ids = Array.from({ length: 1000 }, randomExternalId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 36));
  assert.equal(normalizePrivateKeyPem(pem.trim().replace(/\n/g, "\\n")), pem.trim());
});

test("env files support multiline PEM, exports, and comments", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dana-uat-test-"));
  try {
    const file = path.join(dir, "test.env");
    writeFileSync(file, 'export CLIENT_ID="test"\nDANA_PRIVATE_KEY="' + pem.trim() + '"\nEMPTY=\nCHANNEL=95221 # comment\n');
    const parsed = parseKeyValueFile(file);
    assert.equal(parsed.DANA_PRIVATE_KEY, pem.trim());
    assert.equal(parsed.CLIENT_ID, "test");
    assert.equal(parsed.EMPTY, "");
    assert.equal(parsed.CHANNEL, "95221");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("RSA signing hashes exact serialized body and rejects tampering", async () => {
  const body = JSON.stringify({ amount: { value: "10000.00", currency: "IDR" } });
  const ts = snapTimestampGmt7();
  const signature = await signSnapB2B(pem, ts, body);
  assert.equal(verify(signature, ts, body), true);
  assert.equal(verify(signature, ts, body.replace("10000", "20000")), false);
});

test("all scenarios assert API codes; inconsistency changes only amount", async () => {
  const oldFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.sandbox.dana.id" + endpoint);
    const headers = options.headers;
    const body = JSON.parse(options.body);
    captured.push({ headers, body });
    let code = "2005400";
    if (!headers["X-TIMESTAMP"]) code = "4005402";
    else if (headers["X-SIGNATURE"].length === 64) code = "4015400";
    else {
      assert.equal(verify(headers["X-SIGNATURE"], headers["X-TIMESTAMP"], options.body), true);
      if (body.amount.value.endsWith(".000")) code = "4005401";
      else if (captured.slice(0, -1).some((r) => r.body.partnerReferenceNo === body.partnerReferenceNo)) code = "4045418";
    }
    return new Response(JSON.stringify({ responseCode: code }), { status: Number(code.slice(0, 3)) });
  };
  try {
    for (const scenario of Object.values(SCENARIOS)) assert.equal((await scenario(context())).passed, true);
    const pair = captured.filter((r, i) => captured.some((s, j) => j !== i && r.body.partnerReferenceNo === s.body.partnerReferenceNo));
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0].headers["X-EXTERNAL-ID"], pair[1].headers["X-EXTERNAL-ID"]);
    const changed = structuredClone(pair[1].body);
    changed.amount.value = pair[0].body.amount.value;
    assert.deepEqual(changed, pair[0].body);
  } finally { globalThis.fetch = oldFetch; }
});

test("failed initial order blocks inconsistent second request", async () => {
  const ctx = context();
  let calls = 0;
  ctx.send = async () => { calls++; return { responseCode: "4045408" }; };
  const result = await SCENARIOS["4045418"](ctx);
  assert.equal(result.passed, false);
  assert.equal(calls, 1);
  assert.match(result.note, /initial order/);
});

test("malformed timestamp is signed exactly; network and non-JSON failures are reported", async () => {
  const oldFetch = globalThis.fetch;
  const ctx = context();
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal);
      assert.equal(options.redirect, "error");
      assert.ok(options.headers["X-TIMESTAMP"].includes(" "));
      assert.equal(verify(options.headers["X-SIGNATURE"], options.headers["X-TIMESTAMP"], options.body), true);
      return new Response("upstream unavailable", { status: 502 });
    };
    const result = await sendCreateOrder(ctx, { body: ctx.base(), timestampMode: "malformed" });
    assert.equal(result.httpStatus, 502);
    assert.equal(result.responseCode, null);
    globalThis.fetch = async () => { throw new Error("simulated connection failure"); };
    assert.match((await sendCreateOrder(ctx, { body: ctx.base() })).networkError, /connection failure/);
  } finally { globalThis.fetch = oldFetch; }
});


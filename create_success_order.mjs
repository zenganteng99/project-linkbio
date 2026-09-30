import fs from "fs";
import { exec } from "child_process";
import { normalizePrivateKeyPem, signSnapB2B, snapTimestampGmt7, randomExternalId } from "./run_uat.mjs";

async function run() {
  const MERCHANT_ID = "216620090026052421673";
  const CLIENT_ID = "2026092618040865582354";
  const SUB_MERCHANT_ID = "d5831d89";
  const CHANNEL_ID = "95221";
  const ORIGIN = "https://customlink.pages.dev";

  const rawKey = fs.readFileSync("dana_key.txt", "utf8");
  const privateKeyPem = normalizePrivateKeyPem(rawKey);

  const body = {
    partnerReferenceNo: "UAT-SUCCESS-" + Date.now(),
    merchantId: MERCHANT_ID,
    amount: { value: "11011.00", currency: "IDR" },
    validUpTo: snapTimestampGmt7(360),
    urlParams: [
      { url: ORIGIN + "/", type: "PAY_RETURN", isDeeplink: "N" },
      { url: "https://n8n.automation.dana.id/webhook/3676a08f-b06e-416c-b6cd-bea04f71c4d5", type: "NOTIFICATION", isDeeplink: "N" }
    ],
    additionalInfo: {
      mcc: "5734",
      envInfo: { sourcePlatform: "IPG", terminalType: "SYSTEM" },
      order: { orderTitle: "UAT Finish Notify Success", scenario: "REDIRECT" }
    },
    subMerchantId: SUB_MERCHANT_ID
  };

  const bodyStr = JSON.stringify(body);
  const ts = snapTimestampGmt7(0);
  const sig = await signSnapB2B(privateKeyPem, ts, bodyStr);

  console.log("Membuat transaksi UAT Success (Rp 11.011)...");
  const res = await fetch("https://api.sandbox.dana.id/payment-gateway/v1.0/debit/payment-host-to-host.htm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PARTNER-ID": CLIENT_ID,
      "X-EXTERNAL-ID": randomExternalId(),
      "CHANNEL-ID": CHANNEL_ID,
      "ORIGIN": ORIGIN,
      "X-SIGNATURE": sig,
      "X-TIMESTAMP": ts
    },
    body: bodyStr
  });

  const data = await res.json();
  console.log("Respon Gateway:", data.responseCode, "-", data.responseMessage || data.additionalInfo?.debugMessage);

  if (data.webRedirectUrl) {
    console.log("\nMembuka halaman pembayaran di browser...");
    exec(`start "" "${data.webRedirectUrl}"`);
  } else {
    console.log("Respon lengkap:", JSON.stringify(data, null, 2));
  }
}

run().catch(console.error);
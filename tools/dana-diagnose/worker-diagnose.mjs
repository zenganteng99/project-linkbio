/*
 * worker-diagnose.mjs — endpoint diagnosa LOKAL untuk `wrangler dev`.
 * ---------------------------------------------------------------------------
 * ⚠️  JANGAN DI-DEPLOY. Jalankan hanya lokal:
 *       cd tools/dana-diagnose
 *       npx wrangler dev --port 8787
 *
 * Lalu (PowerShell):
 *   Invoke-RestMethod -Method Post http://127.0.0.1:8787/api/diagnose `
 *     -ContentType 'application/json' -Body '{"variant":"baseline,no-submerchant","live":false}'
 *
 * Keamanan: default adalah DRY RUN. Request nyata ke DANA hanya terjadi bila
 * body berisi {"live": true}.
 *
 * Kredensial dibaca dari (prioritas): .dev.vars di folder ini -> [vars] wrangler.toml.
 */
import { runDiagnostics, preflight } from "./dana-diagnose-core.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS_HEADERS)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Preflight konfigurasi (tanpa jaringan).
    if (url.pathname === "/" || url.pathname === "/api/preflight") {
      return json({
        info: "Endpoint diagnosa LOKAL untuk error pembayaran DANA. Jangan di-deploy.",
        routes: {
          "GET  /api/preflight": "Cek konformitas konfigurasi terhadap spesifikasi DANA",
          "POST /api/diagnose": "Uji varian payload; default dry-run, kirim {\"live\":true} untuk request nyata"
        },
        preflight: preflight(env)
      });
    }

    if (url.pathname === "/api/diagnose") {
      let body = {};
      if (request.method === "POST") {
        try { body = (await request.json()) || {}; } catch (e) { body = {}; }
      }
      const live = body.live === true;
      const report = await runDiagnostics(env, {
        variant: body.variant || "all",
        amount: body.amount,
        packageName: body.packageName,
        dryRun: !live,
        delayMs: Number(body.delayMs) > 0 ? Number(body.delayMs) : 1200
      });
      const anyOk = (report.results || []).some((r) => r.ok);
      const status = live ? (anyOk ? 200 : 502) : 200;
      return json(report, status);
    }

    return json({ error: "Not found", routes: ["GET /", "GET /api/preflight", "POST /api/diagnose"] }, 404);
  }
};

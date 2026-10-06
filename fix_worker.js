const fs = require('fs');

console.log('=== Fixing Worker.js R2 Handlers ===\n');

let worker = fs.readFileSync('worker/worker.js', 'utf8');

// Check if handler exists
if (worker.includes('async function handleUploadImage(request, env)')) {
  console.log('R2 handlers already exist');
  process.exit(0);
}

// R2 handlers to add
const r2code = `
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
    // Delete old file if oldUrl is provided
    if (oldUrl) {
      const oldPath = extractPathFromUrl(oldUrl);
      if (oldPath) {
        try {
          await env.ASSETS_BUCKET.delete(oldPath);
        } catch (delErr) {
          console.error('Failed to delete old file:', delErr);
        }
      }
    }
    // Generate unique filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = 'assets/' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + ext;
    // Upload to R2
    await env.ASSETS_BUCKET.put(filename, file.stream(), {
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
  const match = url.match(/\\/cdn\\/(.+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
`;

// Find insertion point - before HELPER FORMATTING section
const helperIdx = worker.indexOf('// HELPER FORMATTING');
if (helperIdx === -1) {
  console.log('ERROR: Could not find HELPER FORMATTING section');
  process.exit(1);
}

// Insert R2 code
worker = worker.slice(0, helperIdx) + r2code + '\n' + worker.slice(helperIdx);

// Write back
fs.writeFileSync('worker/worker.js', worker);
console.log('SUCCESS: R2 handlers added to worker.js');
console.log('Line count:', worker.split('\n').length);

const fs = require('fs');

console.log('=== Cloudflare R2 Migration ===\n');

// Read worker.js
let worker = fs.readFileSync('worker/worker.js', 'utf8');

// Check if already migrated
if (worker.includes('handleUploadImage')) {
  console.log('- R2 handlers already exist in worker.js');
} else {
  // Add R2 handlers before HELPER FORMATTING
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
    const ext = file.name.split(".").pop() || "jpg";
    const filename = 'assets/' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + ext;
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
  
  worker = worker.replace('// =============================================================================\n// HELPER FORMATTING', r2code + '// =============================================================================\n// HELPER FORMATTING');
  fs.writeFileSync('worker/worker.js', worker);
  console.log('+ Added R2 handlers to worker.js');
}

// Add routes
worker = fs.readFileSync('worker/worker.js', 'utf8');
if (!worker.includes('handleUploadImage(request, env)')) {
  const routes = `\n    // R2 Storage Routes
    if (url.pathname.startsWith("/cdn/") && request.method === "GET") {
      return handleCDN(request, env);
    }
    if (url.pathname === "/api/upload-image" && request.method === "POST") {
      return handleUploadImage(request, env);
    }
    if (url.pathname === "/api/delete-image" && request.method === "POST") {
      return handleDeleteImage(request, env);
    }
`;
  worker = worker.replace('if (request.method === "GET") {', routes + '    if (request.method === "GET") {');
  fs.writeFileSync('worker/worker.js', worker);
  console.log('+ Added R2 routes to worker.js');
} else {
  console.log('- R2 routes already exist');
}

// Update admin.html
let admin = fs.readFileSync('admin.html', 'utf8');

// Update uploadImage
const oldUpload = /async function uploadImage\(file, filePrefix\) \{[\s\S]*?return urlData\.publicUrl;[\s\S]*?\}/g;
const newUpload = `async function uploadImage(file, filePrefix, oldUrl) {
            const optimizedFile = await compressImage(file, 800, 0.75);
            const formData = new FormData();
            formData.append('file', optimizedFile);
            if (oldUrl) {
                formData.append('oldUrl', oldUrl);
            }
            const res = await fetch(WORKER_ORIGIN + '/api/upload-image', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Upload failed');
            }
            const data = await res.json();
            return data.url;
        }`;

if (oldUpload.test(admin)) {
  admin = admin.replace(oldUpload, newUpload);
  fs.writeFileSync('admin.html', admin);
  console.log('+ Updated uploadImage in admin.html');
} else {
  console.log('- uploadImage already updated or not found');
}

// Update deleteImage
const oldDelete = /async function deleteImage\(url\) \{[\s\S]*?\}/g;
const newDelete = `async function deleteImage(url) {
            try {
                const res = await fetch(WORKER_ORIGIN + '/api/delete-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                if (!res.ok) {
                    console.error('Delete image failed:', await res.text());
                }
            } catch (err) {
                console.error("Delete image error:", err);
            }
        }`;

admin = fs.readFileSync('admin.html', 'utf8');
if (oldDelete.test(admin)) {
  admin = admin.replace(oldDelete, newDelete);
  fs.writeFileSync('admin.html', admin);
  console.log('+ Updated deleteImage in admin.html');
} else {
  console.log('- deleteImage already updated or not found');
}

console.log('\n=== Migration Complete ===');
console.log('\nNext steps:');
console.log('1. Deploy worker: cd worker && wrangler deploy');
console.log('2. Git add, commit, and push');

const fs = require('fs');
const path = require('path');

console.log('=== Cloudflare R2 Migration ===\n');

// Update worker.js
const workerPath = path.join(__dirname, 'worker', 'worker.js');
let workerContent = fs.readFileSync(workerPath, 'utf8');

// R2 handlers code
const r2Handlers = `
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
      httpMetadata: {
        contentType: file.type || "image/jpeg"
      }
    });

    const primaryDomain = env.PRIMARY_DOMAIN || "https://customlink.pages.dev";
    const publicUrl = primaryDomain + '/cdn/' + filename;

    return jsonResponse({ 
      success: true, 
      url: publicUrl,
      filename: filename
    });

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

// Insert R2 handlers before HELPER FORMATTING section
if (!workerContent.includes('handleUploadImage')) {
  const insertPoint = workerContent.indexOf('// =============================================================================\\n// HELPER FORMATTING');
  if (insertPoint !== -1) {
    workerContent = workerContent.slice(0, insertPoint) + r2Handlers + '\\n' + workerContent.slice(insertPoint);
    fs.writeFileSync(workerPath, workerContent, 'utf8');
    console.log('✓ Added R2 handlers to worker.js');
  } else {
    console.log('✗ Could not find insertion point in worker.js');
    process.exit(1);
  }
} else {
  console.log('- R2 handlers already exist in worker.js');
}

// Reload worker content
workerContent = fs.readFileSync(workerPath, 'utf8');

// Add routes to main fetch handler
const routes = `
    // R2 Storage Routes
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

if (!workerContent.includes('handleUploadImage(request, env)')) {
  const insertPoint = workerContent.indexOf('if (request.method === "GET") {');
  if (insertPoint !== -1) {
    workerContent = workerContent.slice(0, insertPoint) + routes + '    ' + workerContent.slice(insertPoint);
    fs.writeFileSync(workerPath, workerContent, 'utf8');
    console.log('✓ Added R2 routes to worker.js');
  }
} else {
  console.log('- R2 routes already exist in worker.js');
}

// Update admin.html
const adminPath = path.join(__dirname, 'admin.html');
let adminContent = fs.readFileSync(adminPath, 'utf8');

// Replace uploadImage function
const newUploadImage = `async function uploadImage(file, filePrefix, oldUrl) {
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

const uploadRegex = /async function uploadImage\(file, filePrefix\) \{[\\s\\S]*?return urlData\\.publicUrl;[\\s\\S]*?\}/g;
if (uploadRegex.test(adminContent)) {
  adminContent = adminContent.replace(uploadRegex, newUploadImage);
  console.log('✓ Updated uploadImage function in admin.html');
} else {
  console.log('- uploadImage function already updated or not found');
}

// Replace deleteImage function
const newDeleteImage = `async function deleteImage(url) {
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

const deleteRegex = /async function deleteImage\(url\) \{[\\s\\S]*?\}/g;
if (deleteRegex.test(adminContent)) {
  adminContent = adminContent.replace(deleteRegex, newDeleteImage);
  console.log('✓ Updated deleteImage function in admin.html');
} else {
  console.log('- deleteImage function already updated or not found');
}

fs.writeFileSync(adminPath, adminContent, 'utf8');

console.log('\\n=== Migration Complete ===');
console.log('\\nNext steps:');
console.log('1. Deploy worker: cd worker && wrangler deploy');
console.log('2. Git add, commit, and push');

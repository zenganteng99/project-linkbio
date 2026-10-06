#!/bin/bash

echo "=== Cloudflare R2 Migration Script ==="
echo ""

# 1. Update worker/worker.js - Add R2 handlers before HELPER FORMATTING section
echo "Step 1: Adding R2 handlers to worker.js..."

# Create temporary file with R2 handlers
cat > /tmp/r2_handlers.txt << 'R2EOF'

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
  const match = url.match(/\/cdn\/(.+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
R2EOF

echo "✓ R2 handlers created"
echo ""
echo "Next steps:"
echo "1. Insert handlers into worker.js manually at line 35"
echo "2. Add routes to main fetch handler"
echo "3. Update admin.html"
echo "4. Deploy worker"
echo "5. Git commit and push"

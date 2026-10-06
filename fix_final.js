const fs = require('fs');

console.log('=== Final Fix for R2 Upload ===\n');

let worker = fs.readFileSync('worker/worker.js', 'utf8');

// Find the handleUploadImage function and replace with a simpler version
const oldPattern = /async function handleUploadImage\(request, env\) \{[\s\S]*?async function handleDeleteImage/m;

const newFunction = `async function handleUploadImage(request, env) {
  if (!env.ASSETS_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }
  
  try {
    // Parse FormData from request
    const formData = await request.formData();
    const file = formData.get("file");
    const oldUrl = formData.get("oldUrl");
    
    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "File is required" }, 400);
    }
    
    // Delete old file if oldUrl is provided
    if (oldUrl && typeof oldUrl === 'string') {
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
    const ext = file.name ? file.name.split(".").pop() : 'jpg';
    const filename = 'assets/' + Date.now() + '_' + Math.random().toString(36).substring(7) + '.' + ext;
    
    // Get file content and upload to R2
    const arrayBuffer = await file.arrayBuffer();
    const fileContent = new Uint8Array(arrayBuffer);
    
    await env.ASSETS_BUCKET.put(filename, fileContent, {
      httpMetadata: {
        contentType: file.type || "image/jpeg"
      }
    });
    
    // Return public URL
    const primaryDomain = env.PRIMARY_DOMAIN || "https://customlink.pages.dev";
    const publicUrl = primaryDomain + '/cdn/' + filename;
    
    return jsonResponse({ 
      success: true, 
      url: publicUrl,
      filename: filename
    });
    
  } catch (err) {
    console.error('Upload error:', err);
    return jsonResponse({ error: "Upload failed: " + err.message }, 500);
  }
}

async function handleDeleteImage`;

if (worker.match(oldPattern)) {
  worker = worker.replace(oldPattern, newFunction);
  fs.writeFileSync('worker/worker.js', worker);
  console.log('SUCCESS: handleUploadImage function simplified and fixed');
} else {
  console.log('Pattern not found, trying alternative...');
  
  // Find the function and manually replace
  const lines = worker.split('\n');
  let startIdx = -1;
  let endIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('async function handleUploadImage(request, env)')) {
      startIdx = i;
    }
    if (startIdx !== -1 && lines[i].includes('async function handleDeleteImage')) {
      endIdx = i;
      break;
    }
  }
  
  if (startIdx !== -1 && endIdx !== -1) {
    const newLines = [
      ...lines.slice(0, startIdx),
      newFunction,
      ...lines.slice(endIdx + 1)
    ];
    worker = newLines.join('\n');
    fs.writeFileSync('worker/worker.js', worker);
    console.log('SUCCESS: handleUploadImage function replaced');
  } else {
    console.log('ERROR: Could not find function boundaries');
    process.exit(1);
  }
}

console.log('\nDone! Deploy with: cd worker && wrangler deploy --keep-vars');

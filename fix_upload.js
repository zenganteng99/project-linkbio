const fs = require('fs');

console.log('=== Fixing Upload Handler ===\n');

let worker = fs.readFileSync('worker/worker.js', 'utf8');

// Find and replace the handleUploadImage function
const oldFunction = /async function handleUploadImage\(request, env\) \{[\s\S]*?return jsonResponse\(\{ error: "Upload failed: " \+ err\.message \}, 500\);[\s\S]*?\}\n/;

const newFunction = `async function handleUploadImage(request, env) {
  if (!env.ASSETS_BUCKET) {
    return jsonResponse({ error: "R2 bucket not configured" }, 500);
  }
  try {
    // Get content type and boundary
    const contentType = request.headers.get('content-type') || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: "Content-Type must be multipart/form-data" }, 400);
    }
    
    // Parse FormData
    let formData;
    try {
      formData = await request.formData();
    } catch (formErr) {
      console.error('FormData parsing error:', formErr);
      return jsonResponse({ error: "Failed to parse FormData: " + formErr.message }, 400);
    }
    
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
    
    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const fileContent = new Uint8Array(arrayBuffer);
    
    // Upload to R2
    await env.ASSETS_BUCKET.put(filename, fileContent, {
      httpMetadata: { contentType: file.type || "image/jpeg" }
    });
    
    const primaryDomain = env.PRIMARY_DOMAIN || "https://customlink.pages.dev";
    const publicUrl = primaryDomain + '/cdn/' + filename;
    
    return jsonResponse({ success: true, url: publicUrl, filename: filename });
  } catch (err) {
    console.error('Upload error:', err);
    return jsonResponse({ error: "Upload failed: " + err.message }, 500);
  }
}
`;

if (worker.match(oldFunction)) {
  worker = worker.replace(oldFunction, newFunction);
  fs.writeFileSync('worker/worker.js', worker);
  console.log('SUCCESS: handleUploadImage function updated');
} else {
  console.log('Pattern not found, trying alternative approach...');
  
  // Alternative: replace the entire function from line 39 to 72
  const lines = worker.split('\n');
  const startLine = 38; // 0-indexed, so line 39
  
  // Find end of function (next standalone })
  let endLine = startLine;
  let braceCount = 0;
  let foundFirstBrace = false;
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundFirstBrace = true;
      } else if (char === '}') {
        braceCount--;
      }
    }
    if (foundFirstBrace && braceCount === 0) {
      endLine = i;
      break;
    }
  }
  
  const newLines = [
    ...lines.slice(0, startLine),
    ...newFunction.split('\n'),
    ...lines.slice(endLine + 1)
  ];
  
  worker = newLines.join('\n');
  fs.writeFileSync('worker/worker.js', worker);
  console.log('SUCCESS: handleUploadImage function replaced');
}

console.log('Done!');

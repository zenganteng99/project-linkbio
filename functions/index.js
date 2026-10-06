// Root index.js - handles all routes
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const method = context.request.method;
  
  // Debug: Return env info for /api/debug
  if (url.pathname === "/api/debug") {
    return new Response(JSON.stringify({
      hasASSETS_BUCKET: !!context.env.ASSETS_BUCKET,
      bucketName: context.env.ASSETS_BUCKET ? "defined" : "undefined",
      pathname: url.pathname,
      method: method
    }), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });
  }
  
  // Handle GET /cdn/* paths
  if (method === "GET" && url.pathname.startsWith("/cdn/")) {
    const key = url.pathname.slice(5); // Remove "/cdn"
    
    // Debug: Return what key we're looking for
    if (key.includes("_debug")) {
      return new Response(JSON.stringify({
        debug: true,
        key: key,
        hasBucket: !!context.env.ASSETS_BUCKET,
        bucketType: typeof context.env.ASSETS_BUCKET
      }), { 
        status: 200, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    
    if (!key) return new Response("File not found", { status: 404 });
    
    try {
      const bucket = context.env.ASSETS_BUCKET;
      if (!bucket) {
        return new Response(JSON.stringify({ error: "R2 bucket not bound", hasBucket: false }), { 
          status: 500, 
          headers: { "Content-Type": "application/json" } 
        });
      }
      
      const object = await bucket.get(key);
      if (!object) {
        return new Response(JSON.stringify({ error: "File not found in R2", key: key }), { 
          status: 404, 
          headers: { "Content-Type": "application/json" } 
        });
      }
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
      return new Response(object.body, { headers });
    } catch (err) {
      console.error("CDN Error:", err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
  
  // Handle POST /api/upload-image
  if (method === "POST" && url.pathname === "/api/upload-image") {
    try {
      const formData = await context.request.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "File required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const ext = file.name ? file.name.split(".").pop() : "jpg";
      const filename = "assets/" + Date.now() + "_" + Math.random().toString(36).substring(7) + "." + ext;
      const arrayBuffer = await file.arrayBuffer();
      await context.env.ASSETS_BUCKET?.put(filename, arrayBuffer, { httpMetadata: { contentType: file.type || "image/jpeg" } });
      return new Response(JSON.stringify({ success: true, url: url.origin + "/cdn/" + filename, filename }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      console.error("Upload Error:", err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
  
  // Pass all other requests to static assets
  return context.next();
}

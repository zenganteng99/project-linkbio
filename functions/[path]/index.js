// Catch-all route - handles /cdn/* and static pages
export function onRequestGet(context) {
  const url = new URL(context.request.url);
  
  // Handle /cdn/* paths
  if (url.pathname.startsWith("/cdn/")) {
    const key = url.pathname.replace("/cdn/", "");
    if (!key) {
      return new Response("File not found", { status: 404 });
    }
    
    try {
      const object = context.env.ASSETS_BUCKET?.get(key);
      if (!object) {
        return new Response("File not found", { status: 404 });
      }
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
      
      return new Response(object.body, { headers });
    } catch (err) {
      console.error("CDN Error:", err);
      return new Response("Error", { status: 500 });
    }
  }
  
  // For all other GET requests, pass to static assets
  return context.next();
}
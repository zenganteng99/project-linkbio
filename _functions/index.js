export async function onRequest(context) {
  const url = new URL(context.request.url);
  const { request, env } = context;
  
  // ============================================================
  // R2 CDN ROUTES - Handle image requests from Cloudflare R2
  // ============================================================
  if (url.pathname.startsWith("/cdn/") && request.method === "GET") {
    const key = url.pathname.replace("/cdn/", "");
    if (!key) {
      return new Response("File not found", { status: 404 });
    }
    
    try {
      // Get from R2 bucket
      const object = await env.ASSETS_BUCKET?.get(key);
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
      return new Response("Error retrieving file", { status: 500 });
    }
  }
  
  // ============================================================
  // API: Upload Image to R2
  // ============================================================
  if (url.pathname === "/api/upload-image" && request.method === "POST") {
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      const oldUrl = formData.get("oldUrl");
      
      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "File is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // Delete old file if oldUrl is provided
      if (oldUrl && typeof oldUrl === "string") {
        const match = oldUrl.match(/\/cdn\/(.+)/);
        if (match) {
          const oldPath = decodeURIComponent(match[1]);
          try {
            await env.ASSETS_BUCKET?.delete(oldPath);
          } catch (delErr) {
            console.error("Failed to delete old file:", delErr);
          }
        }
      }
      
      // Generate unique filename
      const ext = file.name ? file.name.split(".").pop() : "jpg";
      const filename = "assets/" + Date.now() + "_" + Math.random().toString(36).substring(7) + "." + ext;
      
      // Upload to R2
      const arrayBuffer = await file.arrayBuffer();
      const fileContent = new Uint8Array(arrayBuffer);
      
      await env.ASSETS_BUCKET?.put(filename, fileContent, {
        httpMetadata: {
          contentType: file.type || "image/jpeg"
        }
      });
      
      // Return public URL - use same domain as the request
      const publicUrl = url.origin + "/cdn/" + filename;
      
      return new Response(JSON.stringify({ success: true, url: publicUrl, filename }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Upload Error:", err);
      return new Response(JSON.stringify({ error: "Upload failed: " + err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // ============================================================
  // API: Delete Image from R2
  // ============================================================
  if (url.pathname === "/api/delete-image" && request.method === "POST") {
    try {
      const body = await request.json();
      const urlToDelete = body.url;
      
      if (!urlToDelete) {
        return new Response(JSON.stringify({ error: "URL is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const match = urlToDelete.match(/\/cdn\/(.+)/);
      if (!match) {
        return new Response(JSON.stringify({ error: "Invalid URL format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      const filePath = decodeURIComponent(match[1]);
      
      // Delete from R2
      await env.ASSETS_BUCKET?.delete(filePath);
      
      return new Response(JSON.stringify({ success: true, deleted: filePath }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Delete Error:", err);
      return new Response(JSON.stringify({ error: "Delete failed: " + err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  
  // ============================================================
  // STATIC PAGE ROUTES
  // ============================================================
  
  // 1. Rute Admin: /admin atau /admin/ -> Buka admin.html
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    const adminHtmlPath = new URL("../admin.html", import.meta.url);
    try {
      const res = await context.env.ASSETS.fetch(adminHtmlPath);
      return new Response(await res.text(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return new Response("Admin page not found", { status: 404 });
    }
  }
  
  // 2. Rute Landing Page Eksplisit: /landingpage atau /landingpage.html
  if (url.pathname === "/landingpage" || url.pathname === "/landingpage.html") {
    const landingPath = new URL("../landingpage.html", import.meta.url);
    try {
      const res = await context.env.ASSETS.fetch(landingPath);
      return new Response(await res.text(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return new Response("Landing page not found", { status: 404 });
    }
  }

  // 3. Rute Root Domain ( / )
  if (url.pathname === "/" || url.pathname === "") {
    if (url.searchParams.has("slug") || url.searchParams.has("p")) {
      const indexHtmlPath = new URL("../index.html", import.meta.url);
      try {
        const res = await context.env.ASSETS.fetch(indexHtmlPath);
        return new Response(await res.text(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (e) {
        return new Response("Index page not found", { status: 404 });
      }
    } else {
      const landingPath = new URL("../landingpage.html", import.meta.url);
      try {
        const res = await context.env.ASSETS.fetch(landingPath);
        return new Response(await res.text(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (e) {
        return new Response("Landing page not found", { status: 404 });
      }
    }
  }

  // 4. Rute Clean Slug Klien (contoh: /toko-berkah) -> Buka index.html
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments.length === 1 && !pathSegments[0].includes('.')) {
    const indexHtmlPath = new URL("../index.html", import.meta.url);
    try {
      const res = await context.env.ASSETS.fetch(indexHtmlPath);
      return new Response(await res.text(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return new Response("Index page not found", { status: 404 });
    }
  }
  
  // Biarkan file statis lainnya (seperti gambar/aset) berjalan normal
  return context.next();
}

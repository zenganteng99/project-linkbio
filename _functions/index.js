export async function onRequest(context) {
  const url = new URL(context.request.url);
  
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
    // Jika ada parameter slug atau p (contoh: ?slug=default), arahkan ke index.html (bio link klien)
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
      // Jika diakses polos tanpa parameter, tampilkan halaman landing page jualan
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
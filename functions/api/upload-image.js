// Handle POST /api/upload-image
export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  try {
    const formData = await context.request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "File required" }), { 
        status: 400, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    const ext = file.name ? file.name.split(".").pop() : "jpg";
    const filename = "assets/" + Date.now() + "_" + Math.random().toString(36).substring(7) + "." + ext;
    const arrayBuffer = await file.arrayBuffer();
    await context.env.ASSETS_BUCKET?.put(filename, arrayBuffer, { 
      httpMetadata: { contentType: file.type || "image/jpeg" } 
    });
    return new Response(JSON.stringify({ 
      success: true, 
      url: url.origin + "/cdn/" + filename, 
      filename 
    }), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });
  } catch (err) {
    console.error("Upload Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
}
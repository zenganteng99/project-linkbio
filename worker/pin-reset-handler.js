// ================================================
// PIN RESET ENDPOINT HANDLERS
// Add these to worker.js
// ================================================

// WhatsApp API Configuration (configure your provider)
const WHATSAPP_API_URL = "https://api.fonnte.com/send";
const WHATSAPP_API_TOKEN = ""; // Set in wrangler secrets

async function sendWhatsAppMessage(phone, message) {
    if (!WHATSAPP_API_TOKEN) {
        console.log("WhatsApp API not configured, code logged:", message);
        return true;
    }
    
    try {
        const response = await fetch(WHATSAPP_API_URL, {
            method: "POST",
            headers: {
                "Authorization": WHATSAPP_API_TOKEN,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                target: phone,
                message: message
            })
        });
        return response.ok;
    } catch (err) {
        console.error("WhatsApp send error:", err);
        return false;
    }
}

// Handle: Send PIN Reset Code
async function handleSendPinResetCode(request, env) {
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
    
    try {
        const { phone, slug } = await request.json();
        
        if (!phone || phone.length < 10) {
            return jsonResponse({ success: false, message: "Nomor tidak valid" }, 400);
        }
        
        // Format phone (Indonesian)
        let formattedPhone = phone.replace(/\D/g, "");
        if (formattedPhone.startsWith("0")) {
            formattedPhone = "62" + formattedPhone.substring(1);
        }
        
        // Generate code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const token = crypto.randomUUID();
        
        // Store in KV (or use Supabase directly)
        const key = `pin_reset:${formattedPhone}`;
        await env.PIN_RESET.put(key, JSON.stringify({
            code: code,
            token: token,
            expires: Date.now() + 600000, // 10 minutes
            attempts: 0
        }));
        
        // Send WhatsApp message
        const message = `Kode verifikasi reset PIN CustomLink Anda adalah: *${code}*\n\nKode ini berlaku selama 10 menit.\n\nJika Anda tidak meminta kode ini, abaikan pesan ini.`;
        
        const sent = await sendWhatsAppMessage(formattedPhone, message);
        
        return jsonResponse({
            success: true,
            verification_token: token,
            message: sent ? "Kode terkirim" : "Kode dihasilkan (WhatsApp belum dikonfigurasi)"
        });
        
    } catch (err) {
        console.error("Send PIN reset code error:", err);
        return jsonResponse({ success: false, message: "Terjadi kesalahan" }, 500);
    }
}

// Handle: Verify PIN Reset Code
async function handleVerifyPinResetCode(request, env) {
    if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }
    
    try {
        const { phone, code, token } = await request.json();
        
        if (!phone || !code || !token) {
            return jsonResponse({ success: false, message: "Data tidak lengkap" }, 400);
        }
        
        // Format phone
        let formattedPhone = phone.replace(/\D/g, "");
        if (formattedPhone.startsWith("0")) {
            formattedPhone = "62" + formattedPhone.substring(1);
        }
        
        // Get stored data
        const key = `pin_reset:${formattedPhone}`;
        const stored = await env.PIN_RESET.get(key, "json");
        
        if (!stored) {
            return jsonResponse({ success: false, message: "Kode tidak ditemukan" }, 400);
        }
        
        // Check expiry
        if (Date.now() > stored.expires) {
            await env.PIN_RESET.delete(key);
            return jsonResponse({ success: false, message: "Kode sudah kadaluarsa" }, 400);
        }
        
        // Check attempts
        if (stored.attempts >= 3) {
            await env.PIN_RESET.delete(key);
            return jsonResponse({ success: false, message: "Terlalu banyak percobaan" }, 400);
        }
        
        // Verify code
        if (stored.code !== code || stored.token !== token) {
            stored.attempts++;
            await env.PIN_RESET.put(key, JSON.stringify(stored));
            return jsonResponse({ success: false, message: "Kode tidak valid" }, 400);
        }
        
        // Generate new reset token
        const newToken = crypto.randomUUID();
        stored.token = newToken;
        stored.verified = true;
        await env.PIN_RESET.put(key, JSON.stringify(stored));
        
        return jsonResponse({
            success: true,
            reset_token: newToken,
            message: "Verifikasi berhasil"
        });
        
    } catch (err) {
        console.error("Verify PIN reset code error:", err);
        return jsonResponse({ success: false, message: "Terjadi kesalahan" }, 500);
    }
}

// Routes to add to worker.js fetch handler:
// if (url.pathname === "/api/send-pin-reset-code" && request.method === "POST") return handleSendPinResetCode(request, env);
// if (url.pathname === "/api/verify-pin-reset-code" && request.method === "POST") return handleVerifyPinResetCode(request, env);
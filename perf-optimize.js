const fs = require('fs');

function applyStoreOptimizations() {
    const path = 'c:/Users/Zen Asegaf/Documents/project-linkbio/store.html';
    let content = fs.readFileSync(path, 'utf8');
    let changes = 0;

    // 1. CRITICAL CSS - Inline above-the-fold styles
    if (!content.includes('/* CRITICAL CSS */')) {
        const criticalCSS = `
    <style>
        body{margin:0;font-family:'Plus Jakarta Sans',sans-serif;min-height:100vh;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);background-size:400% 400%;animation:gradientBG 15s ease infinite}
        @keyframes gradientBG{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        .product-grid{content-visibility:auto;contain-intrinsic-size:1px 600px}
    </style>`;
        content = content.replace('<script src="https://cdn.tailwindcss.com" defer></script>', '<script src="https://cdn.tailwindcss.com" defer></script>' + criticalCSS);
        changes++;
        console.log('[store.html] Critical CSS inline added');
    }

    // 2. sendBeacon optimization
    if (content.includes('keepalive: true')) {
        const old = `fetch(TRACK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, mode: "cors" }).catch(function() {});`;
        const neu = `if (navigator.sendBeacon) { navigator.sendBeacon(TRACK_ENDPOINT, payload); } else { fetch(TRACK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, mode: "no-cors" }).catch(function() {}); }`;
        content = content.replace(old, neu);
        changes++;
        console.log('[store.html] sendBeacon applied');
    }

    // 3. gradientBG simplification
    if (content.includes('50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; }')) {
        content = content.replace('50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; }', '100% { background-position: 100% 50%; }');
        changes++;
        console.log('[store.html] gradientBG simplified');
    }

    // 4. avatar-glow compositor-friendly
    if (content.includes('.avatar-glow { box-shadow: 0 0 25px rgba(236, 72, 153, 0.6)')) {
        const old = `.avatar-glow { box-shadow: 0 0 25px rgba(236, 72, 153, 0.6), 0 0 50px rgba(139, 92, 246, 0.4); animation: pulseGlow 3s infinite alternate; }`;
        const neu = `.avatar-glow { animation: pulseGlow 3s ease-in-out infinite alternate; }
        .avatar-glow::before { content: ''; position: absolute; inset: -4px; border-radius: inherit; background: linear-gradient(135deg, rgba(236, 72, 153, 0.8), rgba(139, 92, 246, 0.8)); background-size: 200% 200%; animation: glowRing 3s ease-in-out infinite alternate; z-index: -1; filter: blur(8px); opacity: 0.7; }
        @keyframes glowRing { 0% { opacity: 0.5; } 100% { opacity: 0.9; } }`;
        content = content.replace(old, neu);
        changes++;
        console.log('[store.html] avatar-glow optimized');
    }

    fs.writeFileSync(path, content, 'utf8');
    return changes;
}

function apply404Optimizations() {
    const path = 'c:/Users/Zen Asegaf/Documents/project-linkbio/404.html';
    let content = fs.readFileSync(path, 'utf8');
    let changes = 0;

    if (content.includes('keepalive: true')) {
        const old = `fetch(TRACK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, mode: "cors" }).catch(function() {});`;
        const neu = `if (navigator.sendBeacon) { navigator.sendBeacon(TRACK_ENDPOINT, payload); } else { fetch(TRACK_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, mode: "no-cors" }).catch(function() {}); }`;
        content = content.replace(old, neu);
        changes++;
        console.log('[404.html] sendBeacon applied');
    }

    fs.writeFileSync(path, content, 'utf8');
    return changes;
}

console.log('=== CustomLink Performance Optimization ===\n');
const s = applyStoreOptimizations();
const p = apply404Optimizations();
console.log(`\nDone! ${s + p} optimizations applied.`);

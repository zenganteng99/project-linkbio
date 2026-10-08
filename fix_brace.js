const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// Fix the malformed function - remove the orphaned comment and add proper structure
const oldCode = `async function scrapeClientSide(targetUrl, index) {
    const isShopee = targetUrl.includes("shopee") || targetUrl.includes("shope.ee");
    // Shopee: Direct fetch

    // Mobile browser headers (most likely to work)
    const mobileHeaders = new Headers();
    mobileHeaders.append("User-Agent", navigator.userAgent);
    mobileHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    mobileHeaders.append("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");

// ============================================================
// CLIENT-SIDE SCRAPING: Direct browser fetch (real IP)
// ============================================================
    let title = "";`;

const newCode = `async function scrapeClientSide(targetUrl, index) {
    const isShopee = targetUrl.includes("shopee") || targetUrl.includes("shope.ee");

    // Mobile browser headers (most likely to work)
    const mobileHeaders = new Headers();
    mobileHeaders.append("User-Agent", navigator.userAgent);
    mobileHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    mobileHeaders.append("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");

    let title = "";`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    console.log('Fixed function structure');
} else {
    console.log('Pattern not found');
}

fs.writeFileSync('admin.html', content);
console.log('Done!');

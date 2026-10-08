const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// The incomplete function starts at line 966 and ends at line 972
// We need to remove it
const incompleteFunc = `async function scrapeClientSide(targetUrl, index) {
    const isShopee = targetUrl.includes("shopee") || targetUrl.includes("shope.ee");
    // Shopee: Direct fetch

    // Mobile browser headers (most likely to work)
    const mobileHeaders = new Headers();
    mobileHeaders.append("User-Agent", navigator.userAgent);
    mobileHeaders.append("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    mobileHeaders.append("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");

// ============================================================
// CLIENT-SIDE SCRAPING`;

if (content.includes(incompleteFunc)) {
    // Replace with just the comment that starts the real function
    content = content.replace(incompleteFunc, `// ============================================================
// CLIENT-SIDE SCRAPING`);
    console.log('Removed incomplete function');
} else {
    console.log('Pattern not found');
}

fs.writeFileSync('admin.html', content);
console.log('Done!');

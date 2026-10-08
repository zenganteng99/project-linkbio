const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// Find the duplicate function block (starting from line 975 area)
// Look for the pattern where duplicate starts
const pattern = `// ============================================================
// CLIENT-SIDE SCRAPING: Direct browser fetch (real IP)
// ============================================================
async function scrapeClientSide(targetUrl, index) {
    const isShopee = targetUrl.includes("shopee") || targetUrl.includes("shope.ee");

    // Mobile browser headers (most likely to work)`;

// Find first occurrence (correct one) and second occurrence (duplicate)
const firstIdx = content.indexOf(pattern);
if (firstIdx > -1) {
    // Find second occurrence
    const secondIdx = content.indexOf(pattern, firstIdx + 1);
    if (secondIdx > -1) {
        // Remove from second occurrence to end of duplicate function
        // Find where the duplicate ends (before applyScrapeResult)
        const applyStart = content.indexOf('// ============================================================\n// Apply scrape result to form', secondIdx);
        if (applyStart > -1) {
            // Remove the duplicate function
            content = content.substring(0, secondIdx) + '\n\n' + content.substring(applyStart);
            console.log('Removed duplicate function');
        }
    } else {
        console.log('Only one occurrence found');
    }
} else {
    console.log('Pattern not found');
}

fs.writeFileSync('admin.html', content);
console.log('Done!');

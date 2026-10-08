const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');
const lines = content.split('\n');

// Find the incomplete function (lines 965-972) and remove it
// Line 965: async function scrapeClientSide
// Line 966: const isShopee
// Line 967: // Shopee: Direct fetch
// Line 968: empty
// Line 969: // Mobile browser headers
// Line 970: const mobileHeaders
// Line 971: mobileHeaders.append...
// Line 972: mobileHeaders.append...
// Line 973: mobileHeaders.append...
// Line 974: empty (incomplete, missing closing });)

// Find where the duplicate starts (second function declaration)
let foundFirst = false;
let secondFuncLine = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('async function scrapeClientSide')) {
        if (!foundFirst) {
            foundFirst = true;
        } else {
            secondFuncLine = i;
            break;
        }
    }
}

if (secondFuncLine > -1) {
    console.log('Found duplicate at line', secondFuncLine + 1);
    // Remove from secondFuncLine to just before "let title = "";"
    let removeEnd = secondFuncLine;
    for (let i = secondFuncLine; i < lines.length; i++) {
        if (lines[i].includes('let title = "";')) {
            removeEnd = i;
            break;
        }
    }
    console.log('Removing lines', secondFuncLine + 1, 'to', removeEnd);
    lines.splice(secondFuncLine, removeEnd - secondFuncLine);
    content = lines.join('\n');
    fs.writeFileSync('admin.html', content);
    console.log('Done!');
} else {
    console.log('Duplicate not found');
}

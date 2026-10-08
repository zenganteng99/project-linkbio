const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');
const lines = content.split(/\r?\n/);

console.log('Total lines:', lines.length);

// Find all function declarations
let funcLines = [];
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('async function scrapeClientSide') || lines[i].includes('function scrapeClientSide')) {
        funcLines.push({ line: i + 1, content: lines[i].trim() });
    }
}

console.log('Found functions at lines:', funcLines.map(f => f.line));

if (funcLines.length > 1) {
    // Remove all duplicates, keep only the first one
    let removed = 0;
    for (let i = 1; i < funcLines.length; i++) {
        const startLine = funcLines[i].line - 1 - removed;
        console.log('Removing function at line', funcLines[i].line, '(index', startLine, ')');
        
        // Find the end of this function (look for the closing });
        let braceCount = 0;
        let foundOpen = false;
        let endLine = startLine;
        
        for (let j = startLine; j < lines.length; j++) {
            for (const char of lines[j]) {
                if (char === '{') { braceCount++; foundOpen = true; }
                if (char === '}') { braceCount--; }
            }
            if (foundOpen && braceCount === 0) {
                endLine = j;
                break;
            }
        }
        
        console.log('  Removing from line', startLine + 1, 'to', endLine + 1);
        lines.splice(startLine, endLine - startLine + 1);
        removed += endLine - startLine + 1;
    }
    
    content = lines.join('\n');
    fs.writeFileSync('admin.html', content);
    console.log('Done! Removed', funcLines.length - 1, 'duplicate(s)');
} else {
    console.log('No duplicates found');
}

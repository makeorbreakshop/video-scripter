const fs = require('fs');
const path = require('path');

// Read the file
const filePath = path.join(__dirname, 'app/videos/[id]/page.tsx');
const content = fs.readFileSync(filePath, 'utf8');

// Basic check for matching brackets and tags
let openBrackets = 0;
let openTags = [];
const lines = content.split('\n');

lines.forEach((line, index) => {
  // Count brackets
  openBrackets += (line.match(/{/g) || []).length;
  openBrackets -= (line.match(/}/g) || []).length;
  
  // Check for JSX tags (simplified)
  const openTagMatches = line.match(/<(\w+)[^>]*>/g) || [];
  const closeTagMatches = line.match(/<\/(\w+)>/g) || [];
  
  openTagMatches.forEach(tag => {
    const tagName = tag.match(/<(\w+)/)[1];
    if (!['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tagName)) {
      openTags.push({ tag: tagName, line: index + 1 });
    }
  });
  
  closeTagMatches.forEach(tag => {
    const tagName = tag.match(/<\/(\w+)>/)[1];
    const lastOpen = openTags.findIndex(t => t.tag === tagName);
    if (lastOpen >= 0) {
      openTags.splice(lastOpen, 1);
    }
  });
  
  // Check around line 322
  if (index >= 315 && index <= 325) {
    console.log(`Line ${index + 1}: ${line}`);
  }
});

console.log('\nBracket balance:', openBrackets);
console.log('\nUnclosed tags:', openTags.slice(0, 10));
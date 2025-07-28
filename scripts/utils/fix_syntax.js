import fs from 'fs';

// Read the file
const filePath = '/Users/brandoncullum/video-scripter/app/dashboard/youtube/competitors/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Find and fix the main syntax issues
// The file appears to have duplicate or malformed content

// Let's rebuild the file properly by finding the main function structure
const lines = content.split('\n');
let fixedLines = [];
let inMainFunction = false;
let braceCount = 0;
let foundMainReturn = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Skip any lines that appear to be duplicated or malformed after the main return
  if (line.includes('export default function CompetitorsPage()') && inMainFunction) {
    // This is a duplicate function declaration, skip it
    continue;
  }
  
  if (line.includes('export default function CompetitorsPage()')) {
    inMainFunction = true;
    fixedLines.push(line);
    continue;
  }
  
  if (inMainFunction) {
    // Count braces to track function scope
    braceCount += (line.match(/\{/g) || []).length;
    braceCount -= (line.match(/\}/g) || []).length;
    
    // If we find a return statement with JSX, mark it
    if (line.trim().startsWith('return (') && !foundMainReturn) {
      foundMainReturn = true;
    }
    
    // If we're at the end of the function (braces balanced), stop
    if (braceCount === 0 && foundMainReturn && line.trim() === '}') {
      fixedLines.push(line);
      break;
    }
    
    fixedLines.push(line);
  } else {
    fixedLines.push(line);
  }
}

// Write the fixed content
fs.writeFileSync(filePath, fixedLines.join('\n'));
console.log('Fixed syntax errors in competitors page');
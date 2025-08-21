#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Track statistics
let filesFixed = 0;
let filesSkipped = 0;
let errors = 0;

// Function to check if a file needs fixing
function needsFix(content) {
  // Check for module-level Supabase client creation
  const patterns = [
    /^const\s+supabase\s*=\s*createClient\(/m,
    /^const\s+\w+\s*=\s*createClient\(/m,
    /^export\s+const\s+supabase\s*=\s*createClient\(/m,
  ];
  
  return patterns.some(pattern => pattern.test(content));
}

// Function to fix a single file
function fixFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (!needsFix(content)) {
      filesSkipped++;
      return;
    }
    
    console.log(`📝 Fixing: ${filePath.replace(projectRoot, '.')}`);
    
    // Extract the createClient call
    const createClientMatch = content.match(/const\s+(\w+)\s*=\s*createClient\([^)]+\)[^;]*;?/);
    if (!createClientMatch) {
      console.log(`  ⚠️  Could not find createClient pattern`);
      filesSkipped++;
      return;
    }
    
    const clientVarName = createClientMatch[1];
    const createClientCall = createClientMatch[0];
    
    // Check if it's using service role or anon key
    const isServiceRole = createClientCall.includes('SERVICE_ROLE_KEY');
    
    // Create the helper function
    const helperFunction = `
// Helper function to get Supabase client
function getSupabaseClient() {
  ${createClientCall.replace(/^const\s+\w+\s*=\s*/, 'return ')}
}`;
    
    // Remove the module-level client creation
    let newContent = content.replace(createClientCall, '');
    
    // Add the helper function after imports
    const importEndMatch = newContent.match(/^(import[\s\S]*?)\n\n/m);
    if (importEndMatch) {
      newContent = newContent.replace(
        importEndMatch[0],
        importEndMatch[0] + helperFunction + '\n'
      );
    } else {
      // If no imports, add at the beginning
      newContent = helperFunction + '\n\n' + newContent;
    }
    
    // Replace all uses of the client variable with function calls
    // In export functions
    newContent = newContent.replace(
      /export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*{/g,
      (match, funcName) => {
        return match + `\n  const ${clientVarName} = getSupabaseClient();`;
      }
    );
    
    // In arrow function exports
    newContent = newContent.replace(
      /export\s+const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*{/g,
      (match) => {
        return match + `\n  const ${clientVarName} = getSupabaseClient();`;
      }
    );
    
    // In regular async functions
    newContent = newContent.replace(
      /^async\s+function\s+(\w+)\s*\([^)]*\)\s*{/gm,
      (match, funcName) => {
        // Don't add if it's the helper function itself
        if (funcName === 'getSupabaseClient') return match;
        // Check if this function uses supabase
        const funcBody = newContent.substring(newContent.indexOf(match));
        const funcEnd = funcBody.search(/^}/m);
        const funcContent = funcBody.substring(0, funcEnd);
        if (funcContent.includes(clientVarName)) {
          return match + `\n  const ${clientVarName} = getSupabaseClient();`;
        }
        return match;
      }
    );
    
    // Write the fixed content
    fs.writeFileSync(filePath, newContent, 'utf8');
    filesFixed++;
    console.log(`  ✅ Fixed successfully`);
    
  } catch (error) {
    console.error(`  ❌ Error fixing ${filePath}: ${error.message}`);
    errors++;
  }
}

// Function to find all TypeScript files
function findTsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    // Skip node_modules and .next
    if (file === 'node_modules' || file === '.next' || file === '.git') {
      return;
    }
    
    if (stat.isDirectory()) {
      findTsFiles(filePath, fileList);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Main execution
console.log('🔧 Fixing Supabase client initialization issues...\n');

// Find all TypeScript files
const tsFiles = findTsFiles(projectRoot);
console.log(`📁 Found ${tsFiles.length} TypeScript files to check\n`);

// Process each file
tsFiles.forEach(fixFile);

// Report results
console.log('\n📊 Results:');
console.log(`  ✅ Files fixed: ${filesFixed}`);
console.log(`  ⏭️  Files skipped: ${filesSkipped}`);
console.log(`  ❌ Errors: ${errors}`);

if (filesFixed > 0) {
  console.log('\n✨ Successfully fixed Supabase initialization issues!');
  console.log('📌 The changes move createClient() calls from module level into functions.');
  console.log('📌 This ensures environment variables are available at runtime.');
}
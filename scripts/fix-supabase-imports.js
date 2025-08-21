#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Files that import from @/lib/supabase
const supabaseFiles = [
  '/app/api/debug/vector-search/route.ts', // Already fixed
  '/app/api/vector/videos/route.ts',
  '/app/api/youtube/patterns/test-discovery/route.ts',
  '/app/api/youtube/patterns/quick-test/route.ts',
  '/app/api/youtube/patterns/predict/route.ts',
  '/app/api/youtube/patterns/list/route.ts',
  '/app/api/youtube/analytics/gaps/route.ts',
  '/app/api/youtube/reporting/daily-import/route.ts',
  '/app/api/youtube/analytics/video-count/route.ts',
  '/app/api/youtube/analytics/existing-dates/route.ts',
  '/app/api/youtube/analytics/backfill/route.ts',
  '/app/api/vector/process-video/route.ts',
  '/app/api/vector/delete-videos/route.ts',
  '/app/api/vector/chunks/route.ts',
  '/app/api/vector/bulk-process/route.ts',
  '/app/api/skyscraper/patterns/route.ts',
  '/app/api/skyscraper/analyze/route.ts',
  '/app/api/skyscraper/analyze-stream/route.ts',
  '/app/api/skyscraper/analyze-single/route.ts'
];

// Files that import from @/lib/supabase-client
const supabaseClientFiles = [
  '/app/api/youtube/patterns/discover-semantic/route.ts', // Already fixed earlier
  '/app/api/google-pse/search/route.ts',
  '/app/api/youtube/discovery/collaborations/route.ts',
  '/app/api/youtube/discovery/playlists/route.ts',
  '/app/api/youtube/discovery/shelves/route.ts',
  '/app/api/youtube/discovery/comments/route.ts',
  '/app/api/youtube/discovery/featured/route.ts',
  '/app/api/youtube/discovery/stats/route.ts',
  '/app/api/youtube/discovery/crawl/route.ts',
  '/app/api/ai/chat/route.ts'
];

let filesFixed = 0;
let errors = 0;

function fixSupabaseImport(filePath) {
  try {
    const fullPath = path.join(projectRoot, filePath);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace import statement
    content = content.replace(
      /import\s*{\s*supabase\s*}\s*from\s*['"]@\/lib\/supabase['"]/,
      "import { getSupabase } from '@/lib/supabase'"
    );
    
    // Add supabase initialization at the start of each exported function
    // Handle export async function
    content = content.replace(
      /export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*{/g,
      (match) => {
        if (!match.includes('getSupabase')) {
          return match + '\n  const supabase = getSupabase();';
        }
        return match;
      }
    );
    
    // Handle export const arrow functions
    content = content.replace(
      /export\s+const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*{/g,
      (match) => {
        if (!match.includes('getSupabase')) {
          return match + '\n  const supabase = getSupabase();';
        }
        return match;
      }
    );
    
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    filesFixed++;
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}: ${error.message}`);
    errors++;
  }
}

function fixSupabaseClientImport(filePath) {
  try {
    const fullPath = path.join(projectRoot, filePath);
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace import statement
    content = content.replace(
      /import\s*{\s*supabase\s*}\s*from\s*['"]@\/lib\/supabase-client['"]/,
      "import { getSupabaseClient } from '@/lib/supabase-client'"
    );
    
    // Add supabase initialization at the start of each exported function
    // Handle export async function
    content = content.replace(
      /export\s+async\s+function\s+(\w+)\s*\([^)]*\)\s*{/g,
      (match) => {
        if (!match.includes('getSupabaseClient')) {
          return match + '\n  const supabase = getSupabaseClient();';
        }
        return match;
      }
    );
    
    // Handle export const arrow functions
    content = content.replace(
      /export\s+const\s+(\w+)\s*=\s*async\s*\([^)]*\)\s*=>\s*{/g,
      (match) => {
        if (!match.includes('getSupabaseClient')) {
          return match + '\n  const supabase = getSupabaseClient();';
        }
        return match;
      }
    );
    
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    filesFixed++;
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}: ${error.message}`);
    errors++;
  }
}

console.log('🔧 Fixing Supabase import statements...\n');

console.log('📁 Fixing files that import from @/lib/supabase...');
supabaseFiles.forEach(fixSupabaseImport);

console.log('\n📁 Fixing files that import from @/lib/supabase-client...');
supabaseClientFiles.forEach(fixSupabaseClientImport);

console.log('\n📊 Results:');
console.log(`  ✅ Files fixed: ${filesFixed}`);
console.log(`  ❌ Errors: ${errors}`);

if (filesFixed > 0) {
  console.log('\n✨ Successfully fixed Supabase imports!');
  console.log('📌 Files now use getSupabase() or getSupabaseClient() functions.');
}
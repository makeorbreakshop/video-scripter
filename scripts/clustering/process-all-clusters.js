import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run a script and wait for completion
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${path.basename(scriptPath)} ${args.join(' ')}`);
    console.log(`${'='.repeat(60)}\n`);
    
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Script ${scriptPath} exited with code ${code}`));
      } else {
        resolve();
      }
    });
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Process all clusters for a given level
 */
async function processLevel(level) {
  console.log(`\n${'*'.repeat(60)}`);
  console.log(`PROCESSING CLUSTERS AT LEVEL ${level}`);
  console.log(`${'*'.repeat(60)}`);
  
  const startTime = Date.now();
  
  try {
    // Step 1: Extract keywords
    console.log('\nSTEP 1: Extracting keywords from clusters...');
    await runScript(path.join(__dirname, 'extract-cluster-keywords.js'), [level.toString()]);
    
    // Step 2: Generate names using LLM
    console.log('\nSTEP 2: Generating cluster names with Claude...');
    await runScript(path.join(__dirname, 'generate-cluster-names.js'), [level.toString(), '10']);
    
    // Step 3: Generate hierarchy
    console.log('\nSTEP 3: Building cluster hierarchy...');
    await runScript(path.join(__dirname, 'generate-cluster-hierarchy.js'), [level.toString()]);
    
    // Step 4: Store in database
    console.log('\nSTEP 4: Storing metadata in database...');
    await runScript(path.join(__dirname, 'store-cluster-metadata.js'), [level.toString(), 'all']);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n✅ Level ${level} processing complete in ${duration} seconds`);
    
  } catch (error) {
    console.error(`\n❌ Error processing level ${level}:`, error.message);
    throw error;
  }
}

/**
 * Main batch processing function
 */
async function main() {
  const args = process.argv.slice(2);
  let levels = [3]; // Default to level 3
  
  // Parse arguments
  if (args.length > 0) {
    if (args[0] === 'all') {
      levels = [1, 2, 3];
    } else {
      levels = args.map(arg => parseInt(arg)).filter(l => [1, 2, 3].includes(l));
    }
  }
  
  if (levels.length === 0) {
    console.error('Invalid level specified. Use 1, 2, 3, or "all"');
    console.log('Usage: node process-all-clusters.js [level|all]');
    console.log('Examples:');
    console.log('  node process-all-clusters.js 3        # Process level 3 only');
    console.log('  node process-all-clusters.js 1 2      # Process levels 1 and 2');
    console.log('  node process-all-clusters.js all      # Process all levels');
    process.exit(1);
  }
  
  console.log('🚀 Starting Cluster Processing Pipeline');
  console.log(`📊 Processing levels: ${levels.join(', ')}`);
  
  const totalStartTime = Date.now();
  
  try {
    // Process each level sequentially
    for (const level of levels) {
      await processLevel(level);
    }
    
    const totalDuration = Math.round((Date.now() - totalStartTime) / 1000);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('✨ ALL PROCESSING COMPLETE!');
    console.log(`Total time: ${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`);
    console.log(`${'='.repeat(60)}`);
    
    // Print summary
    console.log('\nNext steps:');
    console.log('1. Review the generated cluster names in exports/');
    console.log('2. Check the database tables: cluster_metadata and cluster_parent_categories');
    console.log('3. Use the cluster metadata for video classification and discovery');
    
  } catch (error) {
    console.error('\n💥 Pipeline failed:', error.message);
    process.exit(1);
  }
}

// Add help command
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log('Cluster Processing Pipeline');
  console.log('');
  console.log('This script runs the complete cluster naming pipeline:');
  console.log('1. Extract keywords from video titles in each cluster');
  console.log('2. Generate semantic names using Claude AI');
  console.log('3. Build a hierarchical taxonomy');
  console.log('4. Store everything in the database');
  console.log('');
  console.log('Usage: node process-all-clusters.js [level|all]');
  console.log('');
  console.log('Examples:');
  console.log('  node process-all-clusters.js          # Process level 3 (default)');
  console.log('  node process-all-clusters.js 2        # Process level 2 only');
  console.log('  node process-all-clusters.js 1 3      # Process levels 1 and 3');
  console.log('  node process-all-clusters.js all      # Process all levels (1, 2, 3)');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
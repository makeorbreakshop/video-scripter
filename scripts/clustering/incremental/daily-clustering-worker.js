#!/usr/bin/env node

/**
 * Daily Clustering Worker
 * Orchestrates incremental clustering tasks as part of the daily workflow
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(dirname(dirname(dirname(__dirname))), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const WORKFLOW_CONFIG = {
  enableDriftDetection: true,
  enableReclustering: true,
  enableEvolutionTracking: true,
  maxReClusteringPerDay: 5,
  driftCheckInterval: 7, // days
  minVideosBatchSize: 1000
};

/**
 * Run a script and capture output
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${scriptPath} ${args.join(' ')}`);
    
    const process = spawn('node', [scriptPath, ...args], {
      env: { ...process.env },
      cwd: dirname(scriptPath)
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(data.toString().trim());
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(data.toString().trim());
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Script exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr, code });
      }
    });
  });
}

/**
 * Check if drift detection should run today
 */
async function shouldRunDriftDetection() {
  const { data, error } = await supabase
    .from('cluster_assignment_logs')
    .select('created_at')
    .eq('log_type', 'drift_detection')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return true; // Run if no previous runs
  }

  const lastRun = new Date(data.created_at);
  const daysSinceLastRun = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60 * 24);
  
  return daysSinceLastRun >= WORKFLOW_CONFIG.driftCheckInterval;
}

/**
 * Get count of unassigned videos
 */
async function getUnassignedCount() {
  const { count, error } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('topic_cluster_id', null)
    .not('title_embedding', 'is', null);

  return error ? 0 : count || 0;
}

/**
 * Log workflow execution
 */
async function logWorkflowExecution(stage, status, details) {
  await supabase
    .from('cluster_assignment_logs')
    .insert({
      log_type: `workflow_${stage}`,
      stats: {
        status,
        timestamp: new Date().toISOString(),
        ...details
      }
    });
}

/**
 * Main workflow execution
 */
async function main() {
  console.log('=== Daily Clustering Worker ===');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  const workflowResults = {
    started: new Date().toISOString(),
    stages: {}
  };

  try {
    // Stage 1: Incremental Assignment
    console.log('\n--- Stage 1: Incremental Assignment ---');
    const unassignedCount = await getUnassignedCount();
    console.log(`Found ${unassignedCount} unassigned videos`);

    if (unassignedCount >= WORKFLOW_CONFIG.minVideosBatchSize) {
      try {
        await runScript(join(__dirname, 'incremental-assignment.js'));
        workflowResults.stages.assignment = { 
          status: 'completed', 
          videosProcessed: unassignedCount 
        };
      } catch (error) {
        console.error('Assignment failed:', error.message);
        workflowResults.stages.assignment = { 
          status: 'failed', 
          error: error.message 
        };
      }
    } else {
      console.log('Skipping - not enough videos to process');
      workflowResults.stages.assignment = { 
        status: 'skipped', 
        reason: 'insufficient_videos' 
      };
    }

    await logWorkflowExecution('assignment', 
      workflowResults.stages.assignment.status, 
      workflowResults.stages.assignment
    );

    // Stage 2: Drift Detection
    if (WORKFLOW_CONFIG.enableDriftDetection) {
      console.log('\n--- Stage 2: Drift Detection ---');
      
      if (await shouldRunDriftDetection()) {
        try {
          await runScript(join(__dirname, 'cluster-drift-detection.js'));
          
          // Check if drift was detected
          const driftFile = join(
            dirname(dirname(dirname(__dirname))),
            'outputs',
            'clustering',
            'drift',
            `drifted_clusters_${new Date().toISOString().split('T')[0]}.json`
          );
          
          let driftedClusters = [];
          if (await fs.access(driftFile).then(() => true).catch(() => false)) {
            const driftData = JSON.parse(await fs.readFile(driftFile, 'utf-8'));
            driftedClusters = driftData.clusters.map(c => c.clusterId);
          }
          
          workflowResults.stages.driftDetection = { 
            status: 'completed',
            driftedClusters: driftedClusters.length,
            clusters: driftedClusters
          };
        } catch (error) {
          console.error('Drift detection failed:', error.message);
          workflowResults.stages.driftDetection = { 
            status: 'failed', 
            error: error.message 
          };
        }
      } else {
        console.log('Skipping - not scheduled for today');
        workflowResults.stages.driftDetection = { 
          status: 'skipped', 
          reason: 'not_scheduled' 
        };
      }

      await logWorkflowExecution('drift_detection',
        workflowResults.stages.driftDetection.status,
        workflowResults.stages.driftDetection
      );
    }

    // Stage 3: Partial Re-clustering
    if (WORKFLOW_CONFIG.enableReclustering && 
        workflowResults.stages.driftDetection?.driftedClusters > 0) {
      console.log('\n--- Stage 3: Partial Re-clustering ---');
      
      const clustersToProcess = workflowResults.stages.driftDetection.clusters
        .slice(0, WORKFLOW_CONFIG.maxReClusteringPerDay);
      
      try {
        await runScript(
          join(__dirname, 'partial-reclustering.js'),
          clustersToProcess.map(String)
        );
        
        workflowResults.stages.reclustering = { 
          status: 'completed',
          clustersProcessed: clustersToProcess.length,
          clusters: clustersToProcess
        };
      } catch (error) {
        console.error('Re-clustering failed:', error.message);
        workflowResults.stages.reclustering = { 
          status: 'failed', 
          error: error.message 
        };
      }

      await logWorkflowExecution('reclustering',
        workflowResults.stages.reclustering.status,
        workflowResults.stages.reclustering
      );
    }

    // Stage 4: Evolution Tracking
    if (WORKFLOW_CONFIG.enableEvolutionTracking) {
      console.log('\n--- Stage 4: Evolution Tracking ---');
      
      try {
        await runScript(join(__dirname, 'evolution-tracking.js'));
        workflowResults.stages.evolutionTracking = { 
          status: 'completed' 
        };
      } catch (error) {
        console.error('Evolution tracking failed:', error.message);
        workflowResults.stages.evolutionTracking = { 
          status: 'failed', 
          error: error.message 
        };
      }

      await logWorkflowExecution('evolution_tracking',
        workflowResults.stages.evolutionTracking.status,
        workflowResults.stages.evolutionTracking
      );
    }

    // Final summary
    workflowResults.completed = new Date().toISOString();
    workflowResults.duration = 
      (new Date(workflowResults.completed) - new Date(workflowResults.started)) / 1000;

    console.log('\n=== Workflow Complete ===');
    console.log(`Duration: ${workflowResults.duration.toFixed(1)} seconds`);
    console.log('\nStage Summary:');
    
    Object.entries(workflowResults.stages).forEach(([stage, result]) => {
      console.log(`- ${stage}: ${result.status}`);
    });

    // Save workflow summary
    const summaryDir = join(dirname(dirname(dirname(__dirname))), 'outputs', 'clustering', 'workflow');
    await fs.mkdir(summaryDir, { recursive: true });
    
    const summaryFile = join(summaryDir, `workflow_${new Date().toISOString().split('T')[0]}.json`);
    await fs.writeFile(summaryFile, JSON.stringify(workflowResults, null, 2));

    // Update last run timestamp
    await supabase
      .from('cluster_assignment_logs')
      .insert({
        log_type: 'workflow_complete',
        stats: workflowResults
      });

  } catch (error) {
    console.error('\nFatal error in clustering workflow:', error);
    await logWorkflowExecution('workflow', 'failed', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as runDailyClusteringWorkflow };
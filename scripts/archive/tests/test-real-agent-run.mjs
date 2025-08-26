/**
 * Test Real Agent Run with Full Logging
 * Demonstrates the complete logging system with a real video analysis
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:3000';

// Use a real high-performing video ID from the database
const TEST_VIDEO_ID = 'Y-Z4fjwMPsU'; // This should be a real video in your database

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runRealAgentAnalysis() {
  log('\n🚀 Running Real Agent Analysis with Full Logging System\n', 'bright');
  log('=' .repeat(60), 'cyan');
  
  console.log('\nThis test will:');
  console.log('  1. Call the streaming endpoint with a real video');
  console.log('  2. Display real-time progress updates');
  console.log('  3. Save comprehensive logs to files');
  console.log('  4. Generate structured output');
  console.log('  5. Store results in the database\n');
  
  log('Starting agent analysis...', 'yellow');
  
  try {
    const startTime = Date.now();
    
    // Call the streaming endpoint
    const response = await fetch(`${API_BASE_URL}/api/idea-heist/agentic-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: TEST_VIDEO_ID,
        mode: 'agentic',
        options: {
          maxTokens: 50000,
          maxToolCalls: 50,
          maxFanouts: 3,
          timeoutMs: 120000 // 2 minutes
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    // Track progress
    const tasks = new Map();
    let finalResult = null;
    let logFilePath = null;
    let totalCost = 0;
    let totalTokens = 0;
    
    log('\n📊 Real-time Progress:\n', 'bright');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // Display different message types
            switch (data.type) {
              case 'status':
                log(`⏳ ${data.message}`, 'cyan');
                break;
                
              case 'video_found':
                log(`\n📺 Video Found:`, 'green');
                console.log(`   Title: ${data.video.title}`);
                console.log(`   Channel: ${data.video.channel}`);
                console.log(`   Performance: ${data.video.performance}x baseline`);
                console.log(`   Views: ${data.video.views?.toLocaleString()}`);
                break;
                
              case 'task_board':
                log(`\n📋 Task Board:`, 'magenta');
                data.tasks?.forEach(task => {
                  tasks.set(task.id, task);
                  console.log(`   [ ] ${task.name}`);
                });
                break;
                
              case 'task_update':
                const task = tasks.get(data.taskId);
                if (task) {
                  task.status = data.status;
                  const icon = data.status === 'complete' ? '✅' : 
                               data.status === 'running' ? '⏳' : '⬜';
                  log(`   ${icon} ${task.name}`, data.status === 'complete' ? 'green' : 'yellow');
                  
                  if (data.metrics) {
                    console.log(`      → ${data.metrics.tokens || 0} tokens, ${(data.metrics.duration/1000).toFixed(1)}s`);
                  }
                }
                break;
                
              case 'reasoning':
                if (data.message?.includes('Hypothesis')) {
                  log(`\n🧠 AI Reasoning:`, 'magenta');
                  console.log(`   ${data.message.substring(0, 100)}...`);
                }
                break;
                
              case 'tool_call':
                console.log(`   🔧 ${data.tool}: ${data.success ? '✓' : '✗'}`);
                break;
                
              case 'model_call':
                if (data.tokens) totalTokens += data.tokens;
                if (data.cost) totalCost += data.cost;
                break;
                
              case 'metrics_footer':
                log(`\n📈 Running Metrics:`, 'blue');
                console.log(`   Tools: ${data.totalTools}`);
                console.log(`   Tokens: ${data.totalTokens?.toLocaleString()}`);
                console.log(`   Cost: $${data.totalCost?.toFixed(4)}`);
                console.log(`   Duration: ${(data.duration/1000).toFixed(1)}s`);
                totalTokens = data.totalTokens || totalTokens;
                totalCost = data.totalCost || totalCost;
                break;
                
              case 'complete':
                finalResult = data.result;
                logFilePath = data.logFile;
                log(`\n✅ Analysis Complete!`, 'green');
                break;
                
              case 'error':
                log(`\n❌ Error: ${data.message}`, 'red');
                break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    const duration = Date.now() - startTime;
    
    // Display results
    log('\n' + '=' .repeat(60), 'cyan');
    log('\n📊 Final Results:\n', 'bright');
    
    if (finalResult) {
      log('✅ Pattern Discovered:', 'green');
      console.log(`   ${finalResult.summary_md}\n`);
      
      log('📦 Structured Output:', 'blue');
      console.log(`   Version: ${finalResult.version}`);
      console.log(`   Blocks: ${finalResult.blocks?.length || 0}`);
      finalResult.blocks?.forEach(block => {
        console.log(`     - ${block.type}: ${JSON.stringify(block.data).substring(0, 50)}...`);
      });
      
      console.log(`   Source IDs: ${finalResult.source_ids?.length || 0} videos`);
      
      if (finalResult.meta) {
        log('\n⚙️ Metadata:', 'yellow');
        console.log(`   Run time: ${(finalResult.meta.run_time_ms/1000).toFixed(1)}s`);
        console.log(`   Tools used: ${finalResult.meta.tools_used?.join(', ')}`);
        console.log(`   Total tokens: ${finalResult.meta.total_tokens?.toLocaleString()}`);
        console.log(`   Total cost: $${finalResult.meta.total_cost?.toFixed(4)}`);
      }
    }
    
    // Check log files
    if (logFilePath) {
      log('\n📝 Log Files Generated:', 'magenta');
      console.log(`   Main log: ${logFilePath}`);
      
      // Check if files exist
      const logDir = path.dirname(logFilePath);
      const runId = path.basename(logFilePath, '.jsonl');
      
      const files = [
        `${runId}.jsonl`,
        `${runId}_metadata.json`,
        `${runId}_summary.json`
      ];
      
      files.forEach(file => {
        const fullPath = path.join(logDir, file);
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          console.log(`   ✓ ${file} (${stats.size.toLocaleString()} bytes)`);
        }
      });
      
      // Read and display log summary
      const summaryPath = path.join(logDir, `${runId}_summary.json`);
      if (fs.existsSync(summaryPath)) {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        
        log('\n📈 Log Summary:', 'cyan');
        console.log(`   Total entries: ${summary.totalEntries}`);
        console.log(`   Tool calls: ${summary.toolCalls}`);
        console.log(`   Model calls: ${summary.modelCalls}`);
        console.log(`   Errors: ${summary.errors}`);
        console.log(`   Duration: ${(summary.totalDuration/1000).toFixed(1)}s`);
      }
    }
    
    // Performance summary
    log('\n⚡ Performance Summary:', 'bright');
    console.log(`   Total time: ${(duration/1000).toFixed(1)}s`);
    console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
    console.log(`   Cost per second: $${(totalCost / (duration/1000)).toFixed(4)}`);
    
    log('\n' + '=' .repeat(60), 'cyan');
    log('\n🎉 Agent analysis completed successfully!', 'green');
    log('All logs have been saved for debugging and analysis.\n', 'green');
    
    return true;
    
  } catch (error) {
    log(`\n❌ Agent analysis failed: ${error.message}`, 'red');
    console.error(error);
    return false;
  }
}

// Run the test
console.log(colors.bright + '\n🤖 Idea Heist Agent - Real Run Test' + colors.reset);
console.log('Testing the complete logging and streaming system\n');

runRealAgentAnalysis().then(success => {
  if (success) {
    console.log(colors.green + '\n✅ Test completed successfully!' + colors.reset);
  } else {
    console.log(colors.red + '\n❌ Test failed!' + colors.reset);
  }
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
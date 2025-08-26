#!/usr/bin/env node

/**
 * Test UI Requirements for Idea Heist Agent (POST method)
 * 
 * This test validates that the streaming endpoint provides EXACTLY
 * what the UI needs to display real-time updates correctly.
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

class UIRequirementsTest {
  constructor() {
    this.results = [];
    this.requiredMessageTypes = [
      'status',           // Initial status messages
      'video_found',      // Video metadata
      'task_board',       // Initial task list
      'task_update',      // Task progress updates
      'reasoning',        // AI reasoning display
      'tool_call',        // Tool execution
      'model_call',       // Model invocations
      'progress',         // General progress
      'metrics_footer',   // Running metrics
      'complete'          // Final result
    ];
    
    this.receivedTypes = new Set();
    this.messages = [];
  }

  log(status, test, details = '') {
    const symbol = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
    console.log(`${symbol} ${test}${details ? `: ${details}` : ''}`);
    this.results.push({ status, test, details });
  }

  async testStreamingFormat() {
    console.log('\n🔍 Testing Streaming Message Format (POST)\n');
    
    const testVideoId = 'Y-Z4fjwMPsU'; // Test video
    const url = `${BASE_URL}/api/idea-heist/agentic-v2`;
    
    console.log(`📡 POST to: ${url}`);
    console.log(`📝 Video ID: ${testVideoId}`);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: testVideoId,
          mode: 'agentic',
          options: {
            maxTokens: 10000,    // Reduced for testing
            maxToolCalls: 20,    // Reduced for testing
            maxFanouts: 5,
            timeoutMs: 60000     // 1 minute timeout for testing
          }
        })
      });
      
      // Check content type
      const contentType = response.headers.get('content-type');
      if (contentType !== 'text/event-stream') {
        this.log('fail', 'Content-Type', `Expected "text/event-stream", got "${contentType}"`);
        return;
      } else {
        this.log('pass', 'Content-Type', 'Correct SSE content type');
      }
      
      // Read streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let messageCount = 0;
      
      const startTime = Date.now();
      const timeout = 30000; // 30 second timeout
      
      while (true) {
        if (Date.now() - startTime > timeout) {
          this.log('warn', 'Timeout', 'Test limited to 30 seconds');
          break;
        }
        
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            messageCount++;
            
            try {
              const data = JSON.parse(line.slice(6));
              this.messages.push(data);
              this.receivedTypes.add(data.type);
              
              // Validate message structure
              if (!data.type) {
                this.log('fail', `Message ${messageCount}`, 'Missing required "type" field');
                continue;
              }
              
              // Check specific message types
              switch (data.type) {
                case 'video_found':
                  if (!data.video || !data.video.title) {
                    this.log('fail', 'video_found message', 'Missing video data');
                  } else {
                    this.log('pass', 'video_found message', `Found: ${data.video.title.substring(0, 30)}...`);
                  }
                  break;
                  
                case 'task_board':
                  if (!Array.isArray(data.tasks)) {
                    this.log('fail', 'task_board message', 'Tasks must be an array');
                  } else {
                    this.log('pass', 'task_board message', `${data.tasks.length} tasks initialized`);
                  }
                  break;
                  
                case 'task_update':
                  if (!data.taskId || !data.status) {
                    this.log('fail', 'task_update message', 'Missing taskId or status');
                  } else {
                    this.log('pass', 'task_update message', `Task ${data.taskId}: ${data.status}`);
                  }
                  break;
                  
                case 'reasoning':
                  if (!data.message) {
                    this.log('fail', 'reasoning message', 'Missing message content');
                  } else {
                    const preview = data.message.substring(0, 50);
                    this.log('pass', 'reasoning message', preview + '...');
                    
                    // Check for hypothesis
                    if (data.message.includes('Hypothesis') || data.message.includes('hypothesis')) {
                      this.log('pass', 'Hypothesis found', 'AI generated hypothesis');
                    }
                  }
                  break;
                  
                case 'tool_call':
                  if (!data.tool) {
                    this.log('fail', 'tool_call message', 'Missing tool name');
                  } else {
                    this.log('pass', 'tool_call message', `Tool: ${data.tool}`);
                  }
                  break;
                  
                case 'model_call':
                  if (!data.model) {
                    this.log('fail', 'model_call message', 'Missing model name');
                  } else {
                    this.log('pass', 'model_call message', `Model: ${data.model}`);
                  }
                  break;
                  
                case 'metrics_footer':
                  if (typeof data.totalTools !== 'number') {
                    this.log('fail', 'metrics_footer message', 'Missing metrics data');
                  } else {
                    this.log('pass', 'metrics_footer message', `Tools: ${data.totalTools}, Tokens: ${data.totalTokens || 0}`);
                  }
                  break;
                  
                case 'complete':
                  if (!data.result) {
                    this.log('fail', 'complete message', 'Missing result data');
                  } else {
                    this.log('pass', 'complete message', 'Analysis complete with result');
                    
                    // Validate result structure
                    const result = data.result;
                    if (result.version && result.summary_md) {
                      this.log('pass', 'Result structure', 'Valid structured output');
                    } else {
                      this.log('fail', 'Result structure', 'Missing required fields');
                    }
                  }
                  // Exit on complete
                  return;
                  
                case 'error':
                  this.log('fail', 'Error message', data.message || 'Unknown error');
                  break;
                  
                case 'status':
                case 'progress':
                  // These are informational
                  this.log('pass', `${data.type} message`, data.message || '');
                  break;
                  
                default:
                  // Unknown message type
                  this.log('warn', `Unknown message type`, data.type);
              }
              
            } catch (error) {
              this.log('fail', `Message ${messageCount}`, `Invalid JSON: ${error.message}`);
            }
          }
        }
      }
      
    } catch (error) {
      this.log('fail', 'Stream connection', error.message);
    }
  }

  validateUIRequirements() {
    console.log('\n📋 Validating UI Requirements\n');
    
    // Check that we received key message types
    const criticalTypes = ['video_found', 'complete'];
    const missingCritical = criticalTypes.filter(type => !this.receivedTypes.has(type));
    
    if (missingCritical.length > 0) {
      this.log('fail', 'Critical message types', `Missing: ${missingCritical.join(', ')}`);
    } else {
      this.log('pass', 'Critical message types', 'All received');
    }
    
    // Check optional but important types
    const importantTypes = ['task_board', 'reasoning', 'metrics_footer'];
    const missingImportant = importantTypes.filter(type => !this.receivedTypes.has(type));
    
    if (missingImportant.length > 0) {
      this.log('warn', 'Important message types', `Missing: ${missingImportant.join(', ')}`);
    } else {
      this.log('pass', 'Important message types', 'All received');
    }
    
    // Check message ordering
    const typeOrder = this.messages.map(m => m.type);
    if (typeOrder.length > 0) {
      const firstType = typeOrder[0];
      const lastType = typeOrder[typeOrder.length - 1];
      
      if (firstType === 'status' || firstType === 'video_found') {
        this.log('pass', 'Message ordering', `Starts with ${firstType}`);
      } else {
        this.log('warn', 'Message ordering', `Unexpected start: ${firstType}`);
      }
      
      if (lastType === 'complete' || lastType === 'error') {
        this.log('pass', 'Message completion', `Ends with ${lastType}`);
      } else {
        this.log('warn', 'Message completion', `Unexpected end: ${lastType}`);
      }
    }
    
    // Check for hypothesis in reasoning messages
    const reasoningMessages = this.messages.filter(m => m.type === 'reasoning');
    const hasHypothesis = reasoningMessages.some(m => 
      m.message && (m.message.includes('Hypothesis') || m.message.includes('hypothesis'))
    );
    
    if (reasoningMessages.length === 0) {
      this.log('warn', 'Reasoning messages', 'No reasoning messages found');
    } else if (hasHypothesis) {
      this.log('pass', 'Hypothesis detection', `Found in ${reasoningMessages.length} reasoning messages`);
    } else {
      this.log('warn', 'Hypothesis detection', 'No hypothesis found in reasoning');
    }
    
    // Check final result structure
    const completeMessage = this.messages.find(m => m.type === 'complete');
    if (completeMessage && completeMessage.result) {
      const result = completeMessage.result;
      const requiredFields = ['version', 'summary_md', 'blocks', 'source_ids', 'meta'];
      const missingFields = requiredFields.filter(field => !result[field]);
      
      if (missingFields.length === 0) {
        this.log('pass', 'Structured output', 'All required fields present');
      } else {
        this.log('fail', 'Structured output', `Missing: ${missingFields.join(', ')}`);
      }
      
      // Check blocks structure
      if (result.blocks && Array.isArray(result.blocks)) {
        const blockTypes = result.blocks.map(b => b.type);
        this.log('pass', 'Result blocks', `${result.blocks.length} blocks: ${blockTypes.join(', ')}`);
      }
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail').length;
    const warnings = this.results.filter(r => r.status === 'warn').length;
    
    console.log(`\n✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    
    console.log(`\n📨 Total messages received: ${this.messages.length}`);
    console.log(`📝 Unique message types: ${this.receivedTypes.size}`);
    console.log(`   Types: ${Array.from(this.receivedTypes).join(', ')}`);
    
    if (failed === 0 && warnings < 3) {
      console.log('\n🎉 UI requirements validated successfully!');
      console.log('The streaming endpoint is providing correct data for the UI.');
    } else if (failed === 0) {
      console.log('\n✅ Core UI requirements met with minor warnings.');
    } else {
      console.log('\n⚠️  Some UI requirements are not being met.');
      console.log('The UI may not display updates correctly.');
    }
    
    // Show log file location if available
    const completeMsg = this.messages.find(m => m.type === 'complete');
    if (completeMsg && completeMsg.logFile) {
      console.log(`\n📁 Log file: ${completeMsg.logFile}`);
    }
  }

  async run() {
    console.log('🚀 Testing UI Requirements for Idea Heist Agent (POST)');
    console.log('=' .repeat(60));
    
    try {
      // Check if server is running
      const healthCheck = await fetch(BASE_URL).catch(() => null);
      if (!healthCheck) {
        console.error('❌ Server not running. Please run: npm run dev');
        process.exit(1);
      }
      
      // Test streaming format
      await this.testStreamingFormat();
      
      // Validate UI requirements
      this.validateUIRequirements();
      
      // Print summary
      this.printSummary();
      
      process.exit(this.results.filter(r => r.status === 'fail').length > 0 ? 1 : 0);
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Run tests
const test = new UIRequirementsTest();
test.run();
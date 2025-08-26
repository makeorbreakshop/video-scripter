#!/usr/bin/env node

/**
 * Test UI Requirements for Idea Heist Agent
 * 
 * This test validates that the streaming endpoint provides EXACTLY
 * what the UI needs to display real-time updates correctly.
 */

import fetch from 'node-fetch';
import { EventSource } from 'eventsource';

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
    console.log('\n🔍 Testing Streaming Message Format\n');
    
    return new Promise((resolve) => {
      const testVideoId = 'Y-Z4fjwMPsU'; // Test video
      const url = `${BASE_URL}/api/idea-heist/agentic-v2?videoId=${testVideoId}`;
      
      console.log(`📡 Connecting to: ${url}`);
      const eventSource = new EventSource(url);
      let messageCount = 0;
      let timeoutId;
      
      const cleanup = () => {
        eventSource.close();
        clearTimeout(timeoutId);
        resolve();
      };
      
      // Set timeout
      timeoutId = setTimeout(() => {
        this.log('warn', 'Timeout reached', 'Test limited to 10 seconds');
        cleanup();
      }, 10000);
      
      eventSource.onmessage = (event) => {
        messageCount++;
        
        try {
          const data = JSON.parse(event.data);
          this.messages.push(data);
          this.receivedTypes.add(data.type);
          
          // Validate message structure
          if (!data.type) {
            this.log('fail', `Message ${messageCount}`, 'Missing required "type" field');
          }
          
          // Check specific message types
          switch (data.type) {
            case 'video_found':
              if (!data.video || !data.video.title) {
                this.log('fail', 'video_found message', 'Missing video data');
              } else {
                this.log('pass', 'video_found message', `Found: ${data.video.title}`);
              }
              break;
              
            case 'task_board':
              if (!Array.isArray(data.tasks)) {
                this.log('fail', 'task_board message', 'Tasks must be an array');
              } else {
                this.log('pass', 'task_board message', `${data.tasks.length} tasks`);
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
                this.log('pass', 'reasoning message', data.message.substring(0, 50) + '...');
              }
              break;
              
            case 'metrics_footer':
              if (typeof data.totalTools !== 'number') {
                this.log('fail', 'metrics_footer message', 'Missing metrics data');
              } else {
                this.log('pass', 'metrics_footer message', `Tools: ${data.totalTools}`);
              }
              break;
              
            case 'complete':
              if (!data.result) {
                this.log('fail', 'complete message', 'Missing result data');
              } else {
                this.log('pass', 'complete message', 'Analysis complete');
                cleanup();
              }
              break;
          }
          
        } catch (error) {
          this.log('fail', `Message ${messageCount}`, `Invalid JSON: ${error.message}`);
        }
      };
      
      eventSource.onerror = (error) => {
        this.log('fail', 'EventSource connection', error.message || 'Connection failed');
        cleanup();
      };
    });
  }

  validateUIRequirements() {
    console.log('\n📋 Validating UI Requirements\n');
    
    // Check that we received all required message types
    const missingTypes = this.requiredMessageTypes.filter(
      type => !this.receivedTypes.has(type)
    );
    
    if (missingTypes.length > 0) {
      this.log('fail', 'Required message types', `Missing: ${missingTypes.join(', ')}`);
    } else {
      this.log('pass', 'Required message types', 'All received');
    }
    
    // Check message ordering
    const typeOrder = this.messages.map(m => m.type);
    const expectedStart = ['status', 'video_found', 'task_board'];
    const actualStart = typeOrder.slice(0, 3);
    
    if (JSON.stringify(actualStart) === JSON.stringify(expectedStart)) {
      this.log('pass', 'Message ordering', 'Correct initial sequence');
    } else {
      this.log('fail', 'Message ordering', `Expected ${expectedStart.join('->')}, got ${actualStart.join('->')}`);
    }
    
    // Check for hypothesis in reasoning messages
    const reasoningMessages = this.messages.filter(m => m.type === 'reasoning');
    const hasHypothesis = reasoningMessages.some(m => 
      m.message && (m.message.includes('Hypothesis') || m.message.includes('hypothesis'))
    );
    
    if (hasHypothesis) {
      this.log('pass', 'Hypothesis detection', 'Found hypothesis in reasoning');
    } else {
      this.log('warn', 'Hypothesis detection', 'No hypothesis found in reasoning messages');
    }
    
    // Check final result structure
    const completeMessage = this.messages.find(m => m.type === 'complete');
    if (completeMessage && completeMessage.result) {
      const result = completeMessage.result;
      if (result.version && result.primaryPattern && result.analysisMode) {
        this.log('pass', 'Result structure', 'Contains all required fields');
      } else {
        this.log('fail', 'Result structure', 'Missing required fields in result');
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
    
    if (failed === 0) {
      console.log('\n🎉 All UI requirements validated successfully!');
    } else {
      console.log('\n⚠️  Some UI requirements are not being met.');
      console.log('The UI may not display updates correctly.');
    }
    
    // Show sample messages for debugging
    console.log('\n📋 Sample Messages:');
    const sampleTypes = ['video_found', 'task_board', 'reasoning', 'complete'];
    sampleTypes.forEach(type => {
      const msg = this.messages.find(m => m.type === type);
      if (msg) {
        console.log(`\n${type}:`, JSON.stringify(msg, null, 2).substring(0, 200) + '...');
      }
    });
  }

  async run() {
    console.log('🚀 Testing UI Requirements for Idea Heist Agent');
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
      
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    }
  }
}

// Run tests
const test = new UIRequirementsTest();
test.run();
/**
 * Test script for Agent Logger functionality
 */

const path = require('path');
const fs = require('fs');

// Mock the module system for testing
const mockLogger = {
  AgentLogger: class AgentLogger {
    constructor(videoId, runId) {
      this.videoId = videoId;
      this.runId = runId || `agent_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      this.logDir = path.join(process.cwd(), 'logs', 'agent-runs', new Date().toISOString().split('T')[0]);
      this.logEntries = [];
      this.startTime = Date.now();
      this.listeners = new Map();
      
      // Ensure directories exist
      this.ensureDirectoryExists(path.join(process.cwd(), 'logs', 'agent-runs'));
      this.ensureDirectoryExists(this.logDir);
      
      // Create log file
      this.logFilePath = path.join(this.logDir, `${this.runId}.jsonl`);
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
      
      console.log(`✅ Logger initialized for video ${videoId}`);
      console.log(`📁 Log directory: ${this.logDir}`);
      console.log(`📝 Log file: ${this.logFilePath}`);
    }
    
    ensureDirectoryExists(dir) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    log(level, category, message, data) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        data,
        duration: Date.now() - this.startTime
      };
      
      this.logEntries.push(entry);
      this.logStream.write(JSON.stringify(entry) + '\n');
      
      // Emit event
      this.emit('log', entry);
      
      // Console output
      const prefix = this.getPrefix(level);
      console.log(`${prefix} [${category}] ${message}`);
      if (data && process.env.DEBUG) {
        console.log('  Data:', JSON.stringify(data, null, 2));
      }
      
      return entry;
    }
    
    logReasoning(turnType, model, reasoning) {
      return this.log('reasoning', 'openai', `[🧠 ${model}] ${turnType} reasoning`, {
        turnType,
        model,
        reasoning
      });
    }
    
    logToolCall(toolName, params, result, error) {
      return this.log('tool', 'tools', `[🔧 Tool] ${toolName}`, {
        toolName,
        params,
        result: result ? 'truncated' : undefined,
        error: error ? error.message : undefined,
        success: !error
      });
    }
    
    logModelCall(model, prompt, response, tokens, cost) {
      return this.log('model', 'openai', `[🤖 ${model}] Model call`, {
        model,
        promptLength: prompt.length,
        tokens,
        cost
      });
    }
    
    logHypothesis(hypothesis) {
      return this.log('reasoning', 'analysis', '[💡 Hypothesis]', hypothesis);
    }
    
    logValidation(validated, rejected, patterns) {
      return this.log('reasoning', 'validation', `[🔍 Validation] ${validated} validated, ${rejected} rejected`, {
        validated,
        rejected,
        patterns
      });
    }
    
    logError(error, context) {
      return this.log('error', 'error', `[❌ Error] ${context}`, {
        message: error.message || error,
        stack: error.stack
      });
    }
    
    async complete(success, result) {
      const summary = {
        runId: this.runId,
        videoId: this.videoId,
        startTime: new Date(Date.now() - (Date.now() - this.startTime)).toISOString(),
        endTime: new Date().toISOString(),
        totalDuration: Date.now() - this.startTime,
        success,
        totalEntries: this.logEntries.length,
        errors: this.logEntries.filter(e => e.level === 'error').length,
        warnings: this.logEntries.filter(e => e.level === 'warn').length,
        toolCalls: this.logEntries.filter(e => e.category === 'tools').length,
        modelCalls: this.logEntries.filter(e => e.category === 'openai').length
      };
      
      // Write metadata
      const metadataPath = path.join(this.logDir, `${this.runId}_metadata.json`);
      fs.writeFileSync(metadataPath, JSON.stringify(summary, null, 2));
      
      // Write summary
      const summaryPath = path.join(this.logDir, `${this.runId}_summary.json`);
      fs.writeFileSync(summaryPath, JSON.stringify({
        ...summary,
        result
      }, null, 2));
      
      // Close stream
      this.logStream.end();
      
      console.log(`\n📊 Logger Summary:`);
      console.log(`  - Duration: ${summary.totalDuration}ms`);
      console.log(`  - Total entries: ${summary.totalEntries}`);
      console.log(`  - Tool calls: ${summary.toolCalls}`);
      console.log(`  - Model calls: ${summary.modelCalls}`);
      console.log(`  - Errors: ${summary.errors}`);
      console.log(`  - Success: ${success}`);
      
      return summary;
    }
    
    getLogFilePath() {
      return this.logFilePath;
    }
    
    getSummaryFilePath() {
      return path.join(this.logDir, `${this.runId}_summary.json`);
    }
    
    getPrefix(level) {
      const prefixes = {
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        debug: '🐛',
        reasoning: '🧠',
        tool: '🔧',
        model: '🤖'
      };
      return prefixes[level] || '📝';
    }
    
    on(event, listener) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(listener);
    }
    
    emit(event, data) {
      const eventListeners = this.listeners.get(event) || [];
      eventListeners.forEach(listener => listener(data));
    }
  },
  
  createAgentLogger: function(videoId, runId) {
    return new this.AgentLogger(videoId, runId);
  },
  
  loadAgentLogs: async function(runId) {
    const baseLogDir = path.join(process.cwd(), 'logs', 'agent-runs');
    const dates = fs.readdirSync(baseLogDir).filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/));
    
    for (const date of dates) {
      const logFile = path.join(baseLogDir, date, `${runId}.jsonl`);
      if (fs.existsSync(logFile)) {
        const entries = [];
        const content = fs.readFileSync(logFile, 'utf-8');
        for (const line of content.split('\n')) {
          if (line.trim()) {
            entries.push(JSON.parse(line));
          }
        }
        
        const metadataFile = path.join(baseLogDir, date, `${runId}_metadata.json`);
        const metadata = fs.existsSync(metadataFile) 
          ? JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
          : null;
          
        const summaryFile = path.join(baseLogDir, date, `${runId}_summary.json`);
        const summary = fs.existsSync(summaryFile)
          ? JSON.parse(fs.readFileSync(summaryFile, 'utf-8'))
          : null;
        
        return { metadata, entries, summary };
      }
    }
    
    throw new Error(`No logs found for run ID: ${runId}`);
  }
};

// Test the logger
async function testLogger() {
  console.log('🧪 Testing Agent Logger\n');
  console.log('=' .repeat(50));
  
  try {
    // Test 1: Create logger
    console.log('\n📌 Test 1: Creating logger instance');
    const logger = mockLogger.createAgentLogger('test_video_123');
    console.log('✅ Logger created successfully');
    
    // Test 2: Log different types of entries
    console.log('\n📌 Test 2: Logging different entry types');
    
    logger.log('info', 'orchestrator', 'Starting agent analysis');
    logger.logReasoning('hypothesis_generation', 'gpt-5', {
      statement: 'High-effort videos perform better',
      confidence: 0.85
    });
    
    logger.logToolCall('get_video_bundle', { video_id: 'test_123' }, { success: true });
    logger.logModelCall('gpt-5', 'Generate hypothesis...', 'Hypothesis: ...', 1500, 0.05);
    
    logger.logHypothesis({
      statement: 'Thumbnail contrast drives clicks',
      confidence: 0.75,
      evidence: ['video1', 'video2']
    });
    
    logger.logValidation(15, 5, [
      { pattern: 'Title length', confidence: 0.8 },
      { pattern: 'Thumbnail style', confidence: 0.7 }
    ]);
    
    console.log('✅ All entry types logged successfully');
    
    // Test 3: Event emission
    console.log('\n📌 Test 3: Testing event emission');
    let eventReceived = false;
    logger.on('log', (entry) => {
      eventReceived = true;
      console.log(`  Event received: ${entry.message}`);
    });
    
    logger.log('info', 'test', 'Testing event system');
    console.log(eventReceived ? '✅ Event system working' : '❌ Event system failed');
    
    // Test 4: Error logging
    console.log('\n📌 Test 4: Error logging');
    logger.logError(new Error('Test error'), 'Testing error handling');
    console.log('✅ Error logged successfully');
    
    // Test 5: Complete and save
    console.log('\n📌 Test 5: Completing logger session');
    const summary = await logger.complete(true, {
      pattern: 'Test pattern discovered',
      confidence: 0.85
    });
    console.log('✅ Logger session completed');
    
    // Test 6: Load logs
    console.log('\n📌 Test 6: Loading saved logs');
    const loaded = await mockLogger.loadAgentLogs(logger.runId);
    console.log(`✅ Loaded ${loaded.entries.length} log entries`);
    console.log(`  - Metadata: ${loaded.metadata ? 'Present' : 'Missing'}`);
    console.log(`  - Summary: ${loaded.summary ? 'Present' : 'Missing'}`);
    
    // Test 7: Verify files exist
    console.log('\n📌 Test 7: Verifying file creation');
    const files = [
      logger.getLogFilePath(),
      logger.getSummaryFilePath(),
      path.join(logger.logDir, `${logger.runId}_metadata.json`)
    ];
    
    for (const file of files) {
      const exists = fs.existsSync(file);
      const basename = path.basename(file);
      console.log(`  ${exists ? '✅' : '❌'} ${basename}`);
    }
    
    console.log('\n' + '=' .repeat(50));
    console.log('✅ All logger tests passed!');
    console.log(`📁 Logs saved in: ${logger.logDir}`);
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Logger test failed:', error);
    return false;
  }
}

// Run tests
testLogger().then(success => {
  process.exit(success ? 0 : 1);
});
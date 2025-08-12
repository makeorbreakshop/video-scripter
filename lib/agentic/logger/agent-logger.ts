/**
 * Agent Logger - Comprehensive logging system for Idea Heist Agent
 * Saves detailed logs to files for debugging and analysis
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'reasoning' | 'tool' | 'model';
  category: string;
  message: string;
  data?: any;
  turnNumber?: number;
  turnType?: string;
  modelUsed?: string;
  toolName?: string;
  tokensUsed?: number;
  cost?: number;
  duration?: number;
}

export interface AgentRunMetadata {
  runId: string;
  videoId: string;
  startTime: string;
  endTime?: string;
  totalDuration?: number;
  totalTokens?: number;
  totalCost?: number;
  totalToolCalls?: number;
  success?: boolean;
  error?: string;
  mode?: string;
  finalPattern?: any;
}

export class AgentLogger extends EventEmitter {
  private runId: string;
  private videoId: string;
  private logDir: string;
  private logEntries: LogEntry[] = [];
  private metadata: AgentRunMetadata;
  private logStream?: fs.WriteStream;
  private startTime: number;
  private turnMetrics: Map<string, any> = new Map();
  private completed: boolean = false;
  
  constructor(videoId: string, runId?: string) {
    super();
    this.videoId = videoId;
    this.runId = runId || `agent_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.startTime = Date.now();
    
    // Create logs directory structure
    const baseLogDir = path.join(process.cwd(), 'logs', 'agent-runs');
    this.logDir = path.join(baseLogDir, new Date().toISOString().split('T')[0]);
    
    // Ensure directories exist
    this.ensureDirectoryExists(baseLogDir);
    this.ensureDirectoryExists(this.logDir);
    
    // Initialize metadata
    this.metadata = {
      runId: this.runId,
      videoId: this.videoId,
      startTime: new Date().toISOString(),
      totalTokens: 0,
      totalCost: 0,
      totalToolCalls: 0
    };
    
    // Create log file stream
    const logFilePath = path.join(this.logDir, `${this.runId}.jsonl`);
    this.logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    
    // Write initial metadata
    this.writeMetadata();
  }
  
  /**
   * Main logging method
   */
  log(level: LogEntry['level'], category: string, message: string, data?: any): void {
    // Don't log if already completed
    if (this.completed) {
      console.warn('⚠️ Attempted to log after completion:', message);
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
      duration: Date.now() - this.startTime
    };
    
    // Add to in-memory store
    this.logEntries.push(entry);
    
    // Write to file stream (JSONL format for easy parsing)
    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.write(JSON.stringify(entry) + '\n');
    }
    
    // Emit for real-time streaming
    this.emit('log', entry);
    
    // Console output for development
    this.consoleOutput(entry);
  }
  
  /**
   * Log OpenAI reasoning
   */
  logReasoning(turnType: string, model: string, reasoning: any): void {
    this.log('reasoning', 'openai', `[🧠 ${model}] ${turnType} reasoning`, {
      turnType,
      model,
      reasoning,
      turnNumber: this.turnMetrics.size + 1
    });
  }
  
  /**
   * Log tool call
   */
  logToolCall(toolName: string, params: any, result?: any, error?: any): void {
    const toolData = {
      toolName,
      params,
      result: result ? this.truncateData(result) : undefined,
      error: error ? error.message || error : undefined,
      success: !error
    };
    
    this.log('tool', 'tools', `[🔧 Tool] ${toolName}`, toolData);
    
    if (!error) {
      this.metadata.totalToolCalls = (this.metadata.totalToolCalls || 0) + 1;
    }
  }
  
  /**
   * Log model interaction
   */
  logModelCall(model: string, prompt: string, response: any, tokens?: number, cost?: number): void {
    const modelData = {
      model,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 200) + '...',
      responsePreview: typeof response === 'string' 
        ? response.substring(0, 200) + '...'
        : JSON.stringify(response).substring(0, 200) + '...',
      fullPrompt: prompt, // Save full prompt for debugging
      fullResponse: response, // Save full response for debugging
      tokens,
      cost
    };
    
    this.log('model', 'openai', `[🤖 ${model}] Model call`, modelData);
    
    if (tokens) {
      this.metadata.totalTokens = (this.metadata.totalTokens || 0) + tokens;
    }
    if (cost) {
      this.metadata.totalCost = (this.metadata.totalCost || 0) + cost;
    }
  }
  
  /**
   * Log turn completion
   */
  logTurnComplete(turnType: string, turnNumber: number, metrics: any): void {
    const turnData = {
      turnType,
      turnNumber,
      ...metrics
    };
    
    this.turnMetrics.set(turnType, turnData);
    this.log('info', 'orchestrator', `[✅ Turn ${turnNumber}] ${turnType} complete`, turnData);
  }
  
  /**
   * Log hypothesis
   */
  logHypothesis(hypothesis: any): void {
    this.log('reasoning', 'analysis', '[💡 Hypothesis]', hypothesis);
  }
  
  /**
   * Log validation results
   */
  logValidation(validated: number, rejected: number, patterns: any[]): void {
    this.log('reasoning', 'validation', `[🔍 Validation] ${validated} validated, ${rejected} rejected`, {
      validated,
      rejected,
      patterns: patterns.slice(0, 3) // Top 3 patterns
    });
  }
  
  /**
   * Log final pattern
   */
  logFinalPattern(pattern: any): void {
    this.metadata.finalPattern = pattern;
    this.log('info', 'result', '[🎯 Final Pattern]', pattern);
  }
  
  /**
   * Log error
   */
  logError(error: Error | string, context?: string): void {
    const errorData = {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      context
    };
    
    this.log('error', 'error', `[❌ Error] ${context || 'Unknown'}`, errorData);
    this.metadata.error = errorData.message;
  }
  
  /**
   * Complete the logging session
   */
  async complete(success: boolean, finalResult?: any): Promise<void> {
    // Prevent double completion
    if (this.completed) {
      console.warn('⚠️ Logger already completed');
      return;
    }
    this.completed = true;
    
    this.metadata.endTime = new Date().toISOString();
    this.metadata.totalDuration = Date.now() - this.startTime;
    this.metadata.success = success;
    
    if (finalResult) {
      this.metadata.finalPattern = finalResult.pattern;
    }
    
    // Write final metadata
    this.writeMetadata();
    
    // Create summary file
    await this.writeSummary();
    
    // Close stream
    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.end();
    }
    
    this.log('info', 'session', `[📊 Complete] Run ${this.runId} finished`, {
      duration: this.metadata.totalDuration,
      success,
      totalCost: this.metadata.totalCost,
      totalTokens: this.metadata.totalTokens
    });
  }
  
  /**
   * Get streaming iterator for real-time updates
   */
  getStreamingIterator(): AsyncIterableIterator<LogEntry> {
    const logger = this;
    return {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            // Return buffered entries
            if (index < logger.logEntries.length) {
              return { value: logger.logEntries[index++], done: false };
            }
            
            // Wait for new entries
            return new Promise((resolve) => {
              logger.once('log', (entry) => {
                resolve({ value: entry, done: false });
              });
            });
          }
        };
      }
    };
  }
  
  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return path.join(this.logDir, `${this.runId}.jsonl`);
  }
  
  /**
   * Get summary file path
   */
  getSummaryFilePath(): string {
    return path.join(this.logDir, `${this.runId}_summary.json`);
  }
  
  /**
   * Private helper methods
   */
  
  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  private writeMetadata(): void {
    const metadataPath = path.join(this.logDir, `${this.runId}_metadata.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(this.metadata, null, 2));
  }
  
  private async writeSummary(): Promise<void> {
    const summary = {
      ...this.metadata,
      turns: Array.from(this.turnMetrics.values()),
      logEntries: this.logEntries.length,
      errors: this.logEntries.filter(e => e.level === 'error'),
      warnings: this.logEntries.filter(e => e.level === 'warn'),
      toolCalls: this.logEntries.filter(e => e.category === 'tools'),
      modelCalls: this.logEntries.filter(e => e.category === 'openai'),
      reasoningSteps: this.logEntries.filter(e => e.level === 'reasoning')
    };
    
    const summaryPath = this.getSummaryFilePath();
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  }
  
  private truncateData(data: any, maxLength: number = 500): any {
    const str = JSON.stringify(data);
    if (str.length > maxLength) {
      return JSON.parse(str.substring(0, maxLength) + '..."truncated"}');
    }
    return data;
  }
  
  private consoleOutput(entry: LogEntry): void {
    const prefix = this.getLogPrefix(entry.level);
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    
    // Format console output based on level
    let output = `[${timestamp}] ${prefix} ${entry.message}`;
    
    if (entry.data && process.env.NODE_ENV === 'development') {
      output += '\n' + JSON.stringify(entry.data, null, 2);
    }
    
    // Use appropriate console method
    switch (entry.level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'debug':
        if (process.env.DEBUG) {
          console.debug(output);
        }
        break;
      default:
        console.log(output);
    }
  }
  
  private getLogPrefix(level: LogEntry['level']): string {
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
}

/**
 * Factory function to create logger instance
 */
export function createAgentLogger(videoId: string, runId?: string): AgentLogger {
  return new AgentLogger(videoId, runId);
}

/**
 * Load previous run logs for analysis
 */
export async function loadAgentLogs(runId: string): Promise<{
  metadata: AgentRunMetadata;
  entries: LogEntry[];
  summary: any;
}> {
  const baseLogDir = path.join(process.cwd(), 'logs', 'agent-runs');
  
  // Find the log files
  const dates = fs.readdirSync(baseLogDir).filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/));
  
  for (const date of dates) {
    const logFile = path.join(baseLogDir, date, `${runId}.jsonl`);
    const metadataFile = path.join(baseLogDir, date, `${runId}_metadata.json`);
    const summaryFile = path.join(baseLogDir, date, `${runId}_summary.json`);
    
    if (fs.existsSync(logFile)) {
      // Load entries
      const entries: LogEntry[] = [];
      const logContent = fs.readFileSync(logFile, 'utf-8');
      for (const line of logContent.split('\n')) {
        if (line.trim()) {
          entries.push(JSON.parse(line));
        }
      }
      
      // Load metadata
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'));
      
      // Load summary if exists
      let summary = null;
      if (fs.existsSync(summaryFile)) {
        summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
      }
      
      return { metadata, entries, summary };
    }
  }
  
  throw new Error(`No logs found for run ID: ${runId}`);
}
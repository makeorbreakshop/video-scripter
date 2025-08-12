/**
 * Session Manager for Idea Heist Agentic Mode
 * Manages state across model switches and provides recovery
 */

import { 
  SessionState, 
  SessionManager, 
  OrchestratorConfig,
  ModelType,
  ToolCall
} from '@/types/orchestrator';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory session storage (can be replaced with Redis/DB)
 */
class SessionStore {
  private sessions: Map<string, SessionState> = new Map();
  private sessionConfigs: Map<string, OrchestratorConfig> = new Map();
  private sessionHistory: Map<string, SessionState[]> = new Map();

  set(sessionId: string, state: SessionState): void {
    this.sessions.set(sessionId, state);
    
    // Keep history for recovery
    const history = this.sessionHistory.get(sessionId) || [];
    history.push({ ...state });
    if (history.length > 10) {
      history.shift(); // Keep last 10 states
    }
    this.sessionHistory.set(sessionId, history);
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getHistory(sessionId: string): SessionState[] {
    return this.sessionHistory.get(sessionId) || [];
  }

  setConfig(sessionId: string, config: OrchestratorConfig): void {
    this.sessionConfigs.set(sessionId, config);
  }

  getConfig(sessionId: string): OrchestratorConfig | undefined {
    return this.sessionConfigs.get(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sessionConfigs.delete(sessionId);
    this.sessionHistory.delete(sessionId);
  }

  exists(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}

/**
 * Implementation of session management with state compaction
 */
export class SessionManagerImpl implements SessionManager {
  private store: SessionStore;
  private activeModels: Map<string, ModelType> = new Map();

  constructor() {
    this.store = new SessionStore();
  }

  /**
   * Create a new session
   */
  createSession(videoId: string, config: OrchestratorConfig): string {
    const sessionId = uuidv4();
    
    const initialState: SessionState = {
      videoId,
      videoContext: undefined,
      hypothesis: undefined,
      searchResults: undefined,
      validationResults: undefined,
      toolCalls: [],
      errors: []
    };

    this.store.set(sessionId, initialState);
    this.store.setConfig(sessionId, config);
    this.activeModels.set(sessionId, 'gpt-5'); // Start with GPT-5

    console.log(`Created session ${sessionId} for video ${videoId}`);
    return sessionId;
  }

  /**
   * Get current session state
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.store.get(sessionId);
  }

  /**
   * Update session state
   */
  updateSession(sessionId: string, update: Partial<SessionState>): void {
    const current = this.store.get(sessionId);
    if (!current) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updated: SessionState = {
      ...current,
      ...update,
      // Merge arrays instead of replacing
      toolCalls: update.toolCalls 
        ? [...current.toolCalls, ...update.toolCalls]
        : current.toolCalls,
      errors: update.errors
        ? [...current.errors, ...update.errors]
        : current.errors
    };

    // Handle specific updates that should replace, not merge
    if (update.videoContext) {
      updated.videoContext = update.videoContext;
    }
    if (update.hypothesis) {
      updated.hypothesis = update.hypothesis;
    }
    if (update.searchResults) {
      updated.searchResults = update.searchResults;
    }
    if (update.validationResults) {
      updated.validationResults = update.validationResults;
    }

    this.store.set(sessionId, updated);
  }

  /**
   * Handle model switching with state compaction
   */
  switchModel(sessionId: string, fromModel: ModelType, toModel: ModelType): void {
    const state = this.store.get(sessionId);
    if (!state) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log(`Switching model from ${fromModel} to ${toModel} for session ${sessionId}`);
    
    // Compact state for new model context
    const compactedState = this.compactState(state);
    
    // Store compacted version
    this.store.set(sessionId, compactedState);
    this.activeModels.set(sessionId, toModel);

    // Log the switch
    this.updateSession(sessionId, {
      errors: [{
        timestamp: new Date(),
        error: `Model switched from ${fromModel} to ${toModel}`,
        recoverable: true
      }]
    });
  }

  /**
   * End a session
   */
  endSession(sessionId: string): void {
    console.log(`Ending session ${sessionId}`);
    this.activeModels.delete(sessionId);
    
    // Keep session data for a while for debugging
    // In production, might want to persist to DB before deletion
    setTimeout(() => {
      this.store.delete(sessionId);
    }, 300000); // Delete after 5 minutes
  }

  /**
   * Recover a session from history
   */
  recoverSession(sessionId: string): SessionState | undefined {
    const history = this.store.getHistory(sessionId);
    
    if (history.length === 0) {
      console.warn(`No history found for session ${sessionId}`);
      return undefined;
    }

    // Get the last good state (one without critical errors)
    for (let i = history.length - 1; i >= 0; i--) {
      const state = history[i];
      const hasCriticalError = state.errors.some(e => !e.recoverable);
      
      if (!hasCriticalError) {
        console.log(`Recovered session ${sessionId} from history position ${i}`);
        this.store.set(sessionId, state);
        return state;
      }
    }

    // If all states have critical errors, return the most recent
    const lastState = history[history.length - 1];
    this.store.set(sessionId, lastState);
    return lastState;
  }

  /**
   * Compact state for model context switching
   */
  private compactState(state: SessionState): SessionState {
    // Keep only essential information and recent tool calls
    const recentToolCalls = state.toolCalls.slice(-10); // Keep last 10 tool calls
    
    // Summarize validation results
    const validationSummary = state.validationResults ? {
      validated: state.validationResults.validated,
      rejected: state.validationResults.rejected,
      patterns: state.validationResults.patterns.slice(0, 3) // Top 3 patterns
    } : undefined;

    // Compact search results
    const searchSummary = state.searchResults ? {
      semanticNeighbors: state.searchResults.semanticNeighbors.slice(0, 10),
      competitiveSuccesses: state.searchResults.competitiveSuccesses.slice(0, 10),
      totalCandidates: state.searchResults.totalCandidates
    } : undefined;

    return {
      videoId: state.videoId,
      videoContext: state.videoContext,
      hypothesis: state.hypothesis,
      searchResults: searchSummary,
      validationResults: validationSummary,
      toolCalls: recentToolCalls,
      errors: state.errors.filter(e => !e.recoverable).slice(-5) // Keep only unrecoverable errors
    };
  }

  /**
   * Get a summary of the session for logging
   */
  getSessionSummary(sessionId: string): {
    videoId: string;
    currentModel: ModelType;
    toolCallCount: number;
    errorCount: number;
    hasHypothesis: boolean;
    validationCount: number;
  } | undefined {
    const state = this.store.get(sessionId);
    const model = this.activeModels.get(sessionId);
    
    if (!state || !model) {
      return undefined;
    }

    return {
      videoId: state.videoId,
      currentModel: model,
      toolCallCount: state.toolCalls.length,
      errorCount: state.errors.length,
      hasHypothesis: !!state.hypothesis,
      validationCount: state.validationResults?.validated || 0
    };
  }

  /**
   * Export session state for persistence or debugging
   */
  exportSession(sessionId: string): {
    state: SessionState;
    config: OrchestratorConfig | undefined;
    history: SessionState[];
  } | undefined {
    const state = this.store.get(sessionId);
    const config = this.store.getConfig(sessionId);
    const history = this.store.getHistory(sessionId);

    if (!state) {
      return undefined;
    }

    return {
      state,
      config,
      history
    };
  }

  /**
   * Import session state (for recovery from external storage)
   */
  importSession(
    sessionId: string,
    state: SessionState,
    config?: OrchestratorConfig
  ): void {
    this.store.set(sessionId, state);
    
    if (config) {
      this.store.setConfig(sessionId, config);
    }
    
    this.activeModels.set(sessionId, 'gpt-5'); // Default to GPT-5
    console.log(`Imported session ${sessionId}`);
  }

  /**
   * Get all active sessions (for monitoring)
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeModels.keys());
  }

  /**
   * Clean up stale sessions
   */
  cleanupStaleSessions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const sessionId of this.getActiveSessions()) {
      const state = this.store.get(sessionId);
      if (!state) continue;

      // Check last tool call time
      const lastToolCall = state.toolCalls[state.toolCalls.length - 1];
      if (lastToolCall?.endTime) {
        const age = now - lastToolCall.endTime.getTime();
        if (age > maxAgeMs) {
          this.endSession(sessionId);
          cleaned++;
        }
      }
    }

    console.log(`Cleaned up ${cleaned} stale sessions`);
    return cleaned;
  }
}

/**
 * Create a session manager instance
 */
export function createSessionManager(): SessionManager {
  return new SessionManagerImpl();
}

// Export singleton instance
let managerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!managerInstance) {
    managerInstance = createSessionManager();
  }
  return managerInstance;
}
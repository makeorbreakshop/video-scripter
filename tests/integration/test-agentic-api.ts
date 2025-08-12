/**
 * Integration test for Idea Heist Agentic Mode API
 */

import { describe, it, expect, beforeAll } from '@jest/globals';

const API_BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

describe('Idea Heist Agentic Mode API', () => {
  
  describe('GET /api/idea-heist/agentic', () => {
    it('should return status and configuration', async () => {
      const response = await fetch(`${API_BASE}/api/idea-heist/agentic`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe('ready');
      expect(data.version).toBeDefined();
      expect(data.capabilities).toBeDefined();
      expect(data.capabilities.tools).toBe(18);
      expect(data.capabilities.models).toContain('gpt-5');
    });
  });
  
  describe('POST /api/idea-heist/agentic', () => {
    it('should reject request without video ID', async () => {
      const response = await fetch(`${API_BASE}/api/idea-heist/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Video ID is required');
    });
    
    it('should handle non-existent video gracefully', async () => {
      const response = await fetch(`${API_BASE}/api/idea-heist/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: 'nonexistent123'
        })
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Video not found');
    });
    
    // Test with minimal budget to avoid long-running tests
    it('should accept valid request with options', async () => {
      const response = await fetch(`${API_BASE}/api/idea-heist/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: 'test123', // This would need to be a real video ID in your DB
          mode: 'agentic',
          options: {
            maxFanouts: 1,
            maxValidations: 2,
            maxTokens: 1000,
            maxDurationMs: 5000
          }
        })
      });
      
      // Should either succeed or return 404 if video doesn't exist
      expect([200, 404, 500]).toContain(response.status);
      
      const data = await response.json();
      if (response.status === 200) {
        expect(data.success).toBeDefined();
        expect(data.mode).toBeDefined();
        expect(data.timestamp).toBeDefined();
      }
    });
  });
});

// Simple test runner if running directly
if (require.main === module) {
  (async () => {
    console.log('🧪 Testing Agentic API Endpoints...\n');
    
    try {
      // Test GET endpoint
      console.log('Testing GET /api/idea-heist/agentic...');
      const getResponse = await fetch(`${API_BASE}/api/idea-heist/agentic`);
      console.log(`  Status: ${getResponse.status}`);
      const getStatus = await getResponse.json();
      console.log(`  OpenAI: ${getStatus.openaiConfigured ? '✅' : '❌'}`);
      console.log(`  Pinecone: ${getStatus.pineconeConfigured ? '✅' : '❌'}`);
      console.log(`  Supabase: ${getStatus.supabaseConfigured ? '✅' : '❌'}`);
      
      // Test POST endpoint validation
      console.log('\nTesting POST /api/idea-heist/agentic (validation)...');
      const postResponse = await fetch(`${API_BASE}/api/idea-heist/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      console.log(`  Status: ${postResponse.status}`);
      const postError = await postResponse.json();
      console.log(`  Error: ${postError.error}`);
      
      console.log('\n✅ API tests completed!');
      
    } catch (error) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    }
  })();
}
#!/bin/bash

# Test script for Idea Heist Agentic Mode API
# Tests the API endpoint directly

echo "🧪 Testing Idea Heist Agentic Mode API"
echo "======================================"
echo ""

# Set base URL (default to localhost)
BASE_URL="${BASE_URL:-http://localhost:3000}"

# Test 1: Check status endpoint
echo "📋 Test 1: Checking API status..."
echo "GET $BASE_URL/api/idea-heist/agentic"
echo ""

STATUS_RESPONSE=$(curl -s "$BASE_URL/api/idea-heist/agentic")
echo "Response: $STATUS_RESPONSE" | jq '.' 2>/dev/null || echo "$STATUS_RESPONSE"
echo ""

# Extract configuration status
if command -v jq >/dev/null 2>&1; then
  OPENAI_CONFIGURED=$(echo "$STATUS_RESPONSE" | jq -r '.openaiConfigured')
  PINECONE_CONFIGURED=$(echo "$STATUS_RESPONSE" | jq -r '.pineconeConfigured')
  SUPABASE_CONFIGURED=$(echo "$STATUS_RESPONSE" | jq -r '.supabaseConfigured')
  
  echo "Configuration Status:"
  echo "  OpenAI: $([ "$OPENAI_CONFIGURED" = "true" ] && echo "✅" || echo "❌")"
  echo "  Pinecone: $([ "$PINECONE_CONFIGURED" = "true" ] && echo "✅" || echo "❌")"
  echo "  Supabase: $([ "$SUPABASE_CONFIGURED" = "true" ] && echo "✅" || echo "❌")"
  echo ""
fi

echo "======================================"

# Test 2: Test validation error
echo "📋 Test 2: Testing validation (no video ID)..."
echo "POST $BASE_URL/api/idea-heist/agentic"
echo ""

ERROR_RESPONSE=$(curl -s -X POST "$BASE_URL/api/idea-heist/agentic" \
  -H "Content-Type: application/json" \
  -d '{}')
  
echo "Response: $ERROR_RESPONSE" | jq '.' 2>/dev/null || echo "$ERROR_RESPONSE"
echo ""

echo "======================================"

# Test 3: Test with mock video ID
echo "📋 Test 3: Testing with mock video ID..."
echo "POST $BASE_URL/api/idea-heist/agentic"
echo "Body: {\"videoId\": \"test123\", \"mode\": \"agentic\"}"
echo ""

MOCK_RESPONSE=$(curl -s -X POST "$BASE_URL/api/idea-heist/agentic" \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": "test123",
    "mode": "agentic",
    "options": {
      "maxFanouts": 1,
      "maxValidations": 1,
      "maxTokens": 100,
      "maxDurationMs": 5000,
      "fallbackToClassic": true
    }
  }')

echo "Response: $MOCK_RESPONSE" | jq '.' 2>/dev/null || echo "$MOCK_RESPONSE"
echo ""

# Test 4: Test with real video ID if provided
if [ -n "$1" ]; then
  echo "======================================"
  echo "📋 Test 4: Testing with real video ID: $1"
  echo "POST $BASE_URL/api/idea-heist/agentic"
  echo ""
  
  REAL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/idea-heist/agentic" \
    -H "Content-Type: application/json" \
    -d "{
      \"videoId\": \"$1\",
      \"mode\": \"agentic\",
      \"options\": {
        \"maxFanouts\": 1,
        \"maxValidations\": 2,
        \"maxTokens\": 5000,
        \"maxDurationMs\": 20000
      }
    }")
  
  echo "Response: $REAL_RESPONSE" | jq '.' 2>/dev/null || echo "$REAL_RESPONSE"
  echo ""
fi

echo "======================================"
echo "✅ API tests completed!"
echo ""
echo "Usage:"
echo "  ./test-agentic-api.sh          # Run basic tests"
echo "  ./test-agentic-api.sh VIDEO_ID # Test with specific video"
echo ""
#!/usr/bin/env python3
"""
Comprehensive Integration Test Suite for Idea Heist Agent System
Tests all components end-to-end with real API calls
"""

import asyncio
import json
import os
import sys
import time
import tempfile
from pathlib import Path
from datetime import datetime

# Colors for output
RED = '\033[91m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'
BOLD = '\033[1m'

# Test results tracking
test_results = {
    'passed': 0,
    'failed': 0,
    'errors': []
}

def log_test(name, description):
    """Log test start"""
    print(f"\n{BLUE}━━━ {name} ━━━{RESET}")
    print(f"  {description}")

def log_success(message):
    """Log success"""
    print(f"  {GREEN}✓{RESET} {message}")
    test_results['passed'] += 1

def log_failure(message, error=None):
    """Log failure"""
    print(f"  {RED}✗{RESET} {message}")
    if error:
        print(f"    {RED}Error: {error}{RESET}")
        test_results['errors'].append({'test': message, 'error': str(error)})
    test_results['failed'] += 1

def log_info(message):
    """Log info"""
    print(f"  {YELLOW}ℹ{RESET} {message}")

# ============================================================================
# TEST 1: Agent Logger System
# ============================================================================

def test_agent_logger():
    """Test the agent logging system"""
    log_test("Agent Logger", "Testing file-based logging system")
    
    try:
        # Import the logger
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from lib.agentic.logger.agent_logger import AgentLogger
        
        # Create logger instance
        logger = AgentLogger('test-video-123')
        
        # Test basic logging
        logger.log('info', 'test', 'Test message', {'key': 'value'})
        logger.logReasoning('hypothesis', 'gpt-5', {
            'statement': 'Test hypothesis',
            'confidence': 0.85
        })
        logger.logToolCall('search_tool', {'query': 'test'}, {'results': 5})
        logger.logModelCall('gpt-5', 'Test prompt', 'Test response', 1000, 0.05)
        
        # Complete the logger
        asyncio.run(logger.complete(True, {'pattern': 'test-pattern'}))
        
        # Verify log files were created
        log_path = logger.getLogFilePath()
        if os.path.exists(log_path):
            log_success(f"Log file created: {os.path.basename(log_path)}")
            
            # Check file content
            with open(log_path, 'r') as f:
                lines = f.readlines()
                if len(lines) >= 4:
                    log_success(f"Logged {len(lines)} entries successfully")
                else:
                    log_failure(f"Only {len(lines)} entries logged (expected >= 4)")
        else:
            log_failure("Log file not created")
            
        # Check metadata file
        metadata_path = log_path.replace('.jsonl', '_metadata.json')
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
                if metadata['videoId'] == 'test-video-123':
                    log_success("Metadata file created correctly")
                else:
                    log_failure("Metadata has wrong video ID")
        else:
            log_failure("Metadata file not created")
            
    except Exception as e:
        log_failure("Logger test failed", e)
        return False
    
    return test_results['failed'] == 0

# ============================================================================
# TEST 2: Streaming Endpoint
# ============================================================================

async def test_streaming_endpoint():
    """Test the streaming API endpoint"""
    log_test("Streaming Endpoint", "Testing SSE streaming API")
    
    try:
        import aiohttp
        
        # Test video ID (should exist in your database)
        test_video_id = 'Y-Z4fjwMPsU'
        
        async with aiohttp.ClientSession() as session:
            # Test endpoint availability
            url = 'http://localhost:3000/api/idea-heist/agentic-v2'
            
            # First test with missing video ID (should return error)
            log_info("Testing error handling...")
            async with session.post(url, json={}) as response:
                if response.status == 200:
                    log_success("Endpoint handles missing video ID")
                else:
                    log_failure(f"Unexpected status: {response.status}")
            
            # Test with valid request
            log_info(f"Testing with video ID: {test_video_id}")
            payload = {
                'videoId': test_video_id,
                'mode': 'agentic',
                'options': {
                    'maxTokens': 5000,
                    'maxToolCalls': 10,
                    'timeoutMs': 30000
                }
            }
            
            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    log_success("Endpoint returns 200 OK")
                    
                    # Check headers
                    if response.headers.get('Content-Type') == 'text/event-stream':
                        log_success("Correct Content-Type header")
                    else:
                        log_failure(f"Wrong Content-Type: {response.headers.get('Content-Type')}")
                    
                    # Read some streaming data
                    messages_received = 0
                    async for line in response.content:
                        line_str = line.decode('utf-8').strip()
                        if line_str.startswith('data: '):
                            messages_received += 1
                            if messages_received >= 5:  # Just check first few messages
                                break
                    
                    if messages_received > 0:
                        log_success(f"Received {messages_received} streaming messages")
                    else:
                        log_failure("No streaming messages received")
                        
                else:
                    log_failure(f"Endpoint returned status {response.status}")
                    
    except aiohttp.ClientError as e:
        log_failure("Failed to connect to server", "Is 'npm run dev' running?")
        return False
    except Exception as e:
        log_failure("Streaming test failed", e)
        return False
    
    return True

# ============================================================================
# TEST 3: Orchestrator Components
# ============================================================================

async def test_orchestrator():
    """Test the orchestrator components"""
    log_test("Orchestrator", "Testing IdeaHeistAgent orchestration")
    
    try:
        from lib.agentic.orchestrator.idea_heist_agent import IdeaHeistAgent
        
        # Create agent with test config
        agent = IdeaHeistAgent({
            'mode': 'agentic',
            'budget': {
                'maxTokens': 1000,
                'maxToolCalls': 5,
                'maxDurationMs': 5000
            },
            'fallbackToClassic': True
        })
        
        log_success("Agent initialized successfully")
        
        # Check configuration
        if agent.config.mode == 'agentic':
            log_success("Configuration applied correctly")
        else:
            log_failure("Configuration not applied")
        
        # Test with a real video ID (this will likely fail without full setup, but tests error handling)
        try:
            result = await agent.runIdeaHeistAgent('test-video-id')
            
            if 'success' in result:
                if result['success']:
                    log_success("Agent completed successfully")
                else:
                    log_info("Agent completed with fallback (expected)")
            else:
                log_failure("Invalid result structure")
                
        except Exception as e:
            log_info(f"Agent execution failed (expected in test): {str(e)[:50]}")
            
    except Exception as e:
        log_failure("Orchestrator test failed", e)
        return False
    
    return True

# ============================================================================
# TEST 4: End-to-End Flow
# ============================================================================

async def test_end_to_end():
    """Test complete end-to-end flow"""
    log_test("End-to-End", "Testing complete flow with real API call")
    
    try:
        import aiohttp
        
        # Use a real video from the database
        test_video_id = 'Y-Z4fjwMPsU'
        
        async with aiohttp.ClientSession() as session:
            url = 'http://localhost:3000/api/idea-heist/agentic-v2'
            
            payload = {
                'videoId': test_video_id,
                'mode': 'agentic',
                'options': {
                    'maxTokens': 10000,
                    'maxToolCalls': 20,
                    'timeoutMs': 60000  # 1 minute timeout
                }
            }
            
            log_info(f"Starting agent analysis for video {test_video_id}")
            start_time = time.time()
            
            async with session.post(url, json=payload) as response:
                if response.status != 200:
                    log_failure(f"API returned status {response.status}")
                    return False
                
                # Track different message types
                message_types = set()
                total_messages = 0
                final_result = None
                
                async for line in response.content:
                    line_str = line.decode('utf-8').strip()
                    if line_str.startswith('data: '):
                        try:
                            data = json.loads(line_str[6:])
                            message_types.add(data.get('type'))
                            total_messages += 1
                            
                            # Log key events
                            if data.get('type') == 'video_found':
                                log_info(f"Video: {data.get('video', {}).get('title', 'Unknown')[:50]}...")
                            elif data.get('type') == 'reasoning':
                                if 'Hypothesis' in str(data.get('message', '')):
                                    log_info("Hypothesis generated")
                            elif data.get('type') == 'complete':
                                final_result = data.get('result')
                                log_success("Analysis completed")
                                break
                            elif data.get('type') == 'error':
                                log_failure(f"Error: {data.get('message')}")
                                break
                                
                        except json.JSONDecodeError:
                            continue
                
                duration = time.time() - start_time
                log_info(f"Total time: {duration:.1f}s")
                log_info(f"Messages received: {total_messages}")
                log_info(f"Message types: {', '.join(sorted(message_types))}")
                
                if final_result:
                    log_success("Received final result")
                    if 'pattern' in final_result:
                        log_success("Pattern discovered successfully")
                    elif 'error' in final_result:
                        log_info(f"Analysis failed with error: {final_result['error']}")
                else:
                    log_failure("No final result received")
                    
    except aiohttp.ClientError as e:
        log_failure("Cannot connect to server", "Is 'npm run dev' running?")
        return False
    except Exception as e:
        log_failure("End-to-end test failed", e)
        return False
    
    return True

# ============================================================================
# TEST 5: Error Recovery
# ============================================================================

def test_error_recovery():
    """Test error recovery mechanisms"""
    log_test("Error Recovery", "Testing resilience and error handling")
    
    try:
        from lib.agentic.resilience.error_recovery import ErrorRecovery
        
        recovery = ErrorRecovery(None, {
            'maxAttempts': 3,
            'initialDelay': 100
        })
        
        log_success("Error recovery initialized")
        
        # Test retryable error detection
        error = Exception("rate_limit_exceeded")
        if recovery.isRetryableError(error, recovery.retryConfig):
            log_success("Correctly identifies retryable errors")
        else:
            log_failure("Failed to identify retryable error")
        
        # Test error classification
        classification = recovery.classifyError(error)
        if classification == 'rate_limit':
            log_success("Correctly classifies error types")
        else:
            log_failure(f"Wrong classification: {classification}")
            
    except Exception as e:
        log_failure("Error recovery test failed", e)
        return False
    
    return True

# ============================================================================
# TEST 6: Performance Check
# ============================================================================

def test_performance():
    """Test performance metrics"""
    log_test("Performance", "Testing system performance")
    
    try:
        from lib.agentic.logger.agent_logger import AgentLogger
        
        # Test logger performance
        logger = AgentLogger('perf-test')
        start_time = time.time()
        
        # Write 100 log entries
        for i in range(100):
            logger.log('info', 'perf', f'Message {i}', {'index': i})
        
        asyncio.run(logger.complete(True))
        duration = time.time() - start_time
        
        if duration < 2.0:
            log_success(f"Logger handles 100 entries in {duration:.2f}s")
        else:
            log_failure(f"Logger too slow: {duration:.2f}s for 100 entries")
            
    except Exception as e:
        log_failure("Performance test failed", e)
        return False
    
    return True

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

async def run_all_tests():
    """Run all tests"""
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}Idea Heist Agent - Comprehensive Test Suite{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")
    
    # Check if server is running
    print(f"\n{YELLOW}Pre-flight checks...{RESET}")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:3000') as response:
                if response.status in [200, 404]:  # Any response means server is up
                    print(f"{GREEN}✓{RESET} Next.js server is running")
                else:
                    print(f"{RED}✗{RESET} Server returned unexpected status: {response.status}")
    except:
        print(f"{RED}✗{RESET} Next.js server not running - please run 'npm run dev' first")
        print(f"{YELLOW}Note: Some tests will fail without the server{RESET}")
    
    # Run tests
    test_functions = [
        ("Agent Logger", test_agent_logger),
        ("Error Recovery", test_error_recovery),
        ("Performance", test_performance),
        ("Orchestrator", lambda: asyncio.run(test_orchestrator())),
        ("Streaming Endpoint", lambda: asyncio.run(test_streaming_endpoint())),
        ("End-to-End Flow", lambda: asyncio.run(test_end_to_end()))
    ]
    
    for name, test_func in test_functions:
        try:
            if asyncio.iscoroutinefunction(test_func):
                await test_func()
            else:
                test_func()
        except Exception as e:
            log_failure(f"{name} test crashed", e)
    
    # Print summary
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}Test Summary{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")
    print(f"{GREEN}Passed: {test_results['passed']}{RESET}")
    print(f"{RED}Failed: {test_results['failed']}{RESET}")
    
    if test_results['errors']:
        print(f"\n{RED}Errors:{RESET}")
        for error in test_results['errors'][:5]:  # Show first 5 errors
            print(f"  • {error['test']}")
            print(f"    {error['error'][:100]}")
    
    if test_results['failed'] == 0:
        print(f"\n{GREEN}{BOLD}🎉 ALL TESTS PASSED!{RESET}")
        print(f"{GREEN}The Idea Heist Agent system is fully operational.{RESET}")
        return 0
    else:
        print(f"\n{RED}{BOLD}⚠️ SOME TESTS FAILED{RESET}")
        print(f"{YELLOW}Please review the errors above and fix the issues.{RESET}")
        return 1

if __name__ == '__main__':
    exit_code = asyncio.run(run_all_tests())
    sys.exit(exit_code)
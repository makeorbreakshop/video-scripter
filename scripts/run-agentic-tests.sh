#!/bin/bash

# Agentic Mode Implementation Test Runner
# Run this script after implementing each component

set -e  # Exit on any error

echo "🧪 Agentic Mode Test Runner"
echo "============================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if specific test type is requested
TEST_TYPE=${1:-all}

run_test_suite() {
    local suite_name=$1
    local test_command=$2
    
    echo -e "\n${YELLOW}Running $suite_name...${NC}"
    if eval $test_command; then
        echo -e "${GREEN}✓ $suite_name passed${NC}"
        return 0
    else
        echo -e "${RED}✗ $suite_name failed${NC}"
        return 1
    fi
}

# Install test dependencies if needed
if [ "$TEST_TYPE" == "setup" ] || [ "$TEST_TYPE" == "all" ]; then
    echo "📦 Installing test dependencies..."
    pip install pytest pytest-asyncio httpx pytest-mock pytest-cov
    npm install --save-dev jest supertest @types/jest
fi

# Run different test suites based on argument
case $TEST_TYPE in
    tools)
        run_test_suite "Tool Tests" "pytest tests/tools/ -v"
        ;;
    api)
        run_test_suite "API Tests" "pytest tests/api/ -v"
        ;;
    integration)
        run_test_suite "Integration Tests" "pytest tests/integration/ -v -m integration"
        ;;
    unit)
        run_test_suite "Unit Tests" "pytest tests/ -v -m 'not integration'"
        ;;
    coverage)
        run_test_suite "Coverage Report" "pytest tests/ --cov=api --cov=lib --cov-report=html --cov-report=term"
        echo "📊 Coverage report generated in htmlcov/index.html"
        ;;
    quick)
        # Quick smoke test for development
        run_test_suite "Quick Smoke Test" "pytest tests/ -v -m 'not slow' --maxfail=1"
        ;;
    phase1)
        # Phase 1 validation tests
        echo "🎯 Phase 1 Validation"
        run_test_suite "Tool Infrastructure" "pytest tests/tools/test_base_wrapper.py -v"
        run_test_suite "Context Tools" "pytest tests/tools/test_get_video_bundle.py tests/tools/test_get_channel_baseline.py -v"
        run_test_suite "Search Tools" "pytest tests/tools/test_search_*.py -v"
        run_test_suite "API Endpoints" "pytest tests/api/test_tools_endpoints.py -v"
        ;;
    all)
        # Run all test suites
        echo "🔍 Running complete test suite..."
        
        FAILED=0
        
        run_test_suite "Unit Tests" "pytest tests/ -v -m 'not integration'" || FAILED=1
        run_test_suite "Integration Tests" "pytest tests/integration/ -v" || FAILED=1
        run_test_suite "API Tests" "pytest tests/api/ -v" || FAILED=1
        run_test_suite "TypeScript Tests" "npm test" || FAILED=1
        
        if [ $FAILED -eq 0 ]; then
            echo -e "\n${GREEN}✅ All tests passed!${NC}"
            
            # Generate coverage report
            echo -e "\n📊 Generating coverage report..."
            pytest tests/ --cov=api --cov=lib --cov-report=term --cov-report=html
            
            exit 0
        else
            echo -e "\n${RED}❌ Some tests failed. Please fix before proceeding.${NC}"
            exit 1
        fi
        ;;
    watch)
        # Watch mode for development
        echo "👁️  Watching for changes..."
        pytest tests/ -v --maxfail=1 --tb=short --watch
        ;;
    *)
        echo "Usage: $0 [setup|tools|api|integration|unit|coverage|quick|phase1|all|watch]"
        echo ""
        echo "Options:"
        echo "  setup       - Install test dependencies"
        echo "  tools       - Test individual tools"
        echo "  api         - Test API endpoints"
        echo "  integration - Run integration tests"
        echo "  unit        - Run unit tests only"
        echo "  coverage    - Generate coverage report"
        echo "  quick       - Quick smoke test"
        echo "  phase1      - Validate Phase 1 implementation"
        echo "  all         - Run all tests (default)"
        echo "  watch       - Watch mode for development"
        exit 1
        ;;
esac

echo -e "\n✨ Test run complete!"
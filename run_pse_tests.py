#!/usr/bin/env python3
"""
Script to run Google PSE tests with proper environment setup
"""

import os
import sys
import subprocess

# Set up test environment
os.environ['TESTING'] = 'true'
os.environ['NODE_ENV'] = 'test'

# Run pytest with verbose output
result = subprocess.run(
    [sys.executable, '-m', 'pytest', 'tests/test_google_pse_search.py', '-v', '-s', '--tb=short'],
    cwd=os.path.dirname(os.path.abspath(__file__))
)

sys.exit(result.returncode)
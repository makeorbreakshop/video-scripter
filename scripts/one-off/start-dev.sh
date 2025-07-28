#!/bin/bash

# Kill any processes on ports 3000-3001
echo "🧹 Cleaning up ports 3000-3001..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Wait a moment for ports to clear
sleep 1

# Start development server
echo "🚀 Starting development server..."
npm run dev
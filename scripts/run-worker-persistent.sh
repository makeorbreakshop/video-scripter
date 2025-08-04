#!/bin/bash

# Run worker with caffeinate to prevent sleep
# and nohup to keep running even if terminal closes

echo "Starting persistent LLM Summary Worker..."
echo "This will keep running even if your computer sleeps or terminal closes"

# Create logs directory if it doesn't exist
mkdir -p logs

# Run with caffeinate (prevents sleep) and nohup (survives terminal close)
caffeinate -i nohup npm run worker:llm-summary > logs/llm-summary-worker.log 2>&1 &

# Get the process ID
PID=$!
echo "Worker started with PID: $PID"
echo "Logs: tail -f logs/llm-summary-worker.log"
echo "To stop: kill $PID"

# Save PID to file for easy stopping later
echo $PID > logs/llm-summary-worker.pid

echo "Worker is running in background and will continue even if you close this terminal"
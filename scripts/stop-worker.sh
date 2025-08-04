#!/bin/bash

# Stop the persistent worker

if [ -f logs/llm-summary-worker.pid ]; then
    PID=$(cat logs/llm-summary-worker.pid)
    echo "Stopping worker with PID: $PID"
    kill $PID
    rm logs/llm-summary-worker.pid
    echo "Worker stopped"
else
    echo "No worker PID file found"
    echo "You can manually check for running workers with: ps aux | grep 'llm-summary-worker'"
fi
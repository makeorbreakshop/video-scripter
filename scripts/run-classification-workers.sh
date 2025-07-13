#!/bin/bash

# Classification Workers Launcher Script
# This script helps run the classification workers

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    echo -e "${BLUE}Classification Workers Launcher${NC}"
    echo ""
    echo "Usage: $0 [worker-type]"
    echo ""
    echo "Available workers:"
    echo "  format     - Run format classification worker (uses LLM for video formats)"
    echo "  topic      - Run topic classification worker (uses BERTopic clusters)"
    echo "  video      - Run combined video classification worker (both topic & format)"
    echo "  all        - Run all workers in separate terminals"
    echo ""
    echo "Examples:"
    echo "  $0 format"
    echo "  $0 topic"
    echo "  $0 video"
    echo "  $0 all"
    echo ""
    echo -e "${YELLOW}Note: Workers are controlled via the UI at http://localhost:3000/dashboard/workers${NC}"
}

# Check if tsx is installed
if ! command -v tsx &> /dev/null; then
    echo -e "${RED}Error: tsx is not installed${NC}"
    echo "Please install it with: npm install -g tsx"
    exit 1
fi

# Check if no arguments provided
if [ $# -eq 0 ]; then
    usage
    exit 0
fi

# Function to run a worker
run_worker() {
    local worker_file=$1
    local worker_name=$2
    
    if [ ! -f "$worker_file" ]; then
        echo -e "${RED}Error: Worker file not found: $worker_file${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Starting $worker_name...${NC}"
    tsx "$worker_file"
}

# Function to run worker in new terminal (macOS)
run_in_terminal() {
    local worker_file=$1
    local worker_name=$2
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        osascript -e "tell app \"Terminal\" to do script \"cd $(pwd) && tsx $worker_file\""
    else
        # Linux/Other - try common terminal emulators
        if command -v gnome-terminal &> /dev/null; then
            gnome-terminal -- bash -c "cd $(pwd) && tsx $worker_file; exec bash"
        elif command -v xterm &> /dev/null; then
            xterm -e "cd $(pwd) && tsx $worker_file" &
        else
            echo -e "${YELLOW}Could not open new terminal. Running in background...${NC}"
            tsx "$worker_file" &
        fi
    fi
}

# Main logic
case "$1" in
    format)
        run_worker "format-classification-worker.ts" "Format Classification Worker"
        ;;
    topic)
        run_worker "topic-classification-worker.ts" "Topic Classification Worker"
        ;;
    video)
        run_worker "video-classification-worker.ts" "Video Classification Worker"
        ;;
    all)
        echo -e "${BLUE}Starting all classification workers in separate terminals...${NC}"
        run_in_terminal "format-classification-worker.ts" "Format Classification Worker"
        sleep 2
        run_in_terminal "topic-classification-worker.ts" "Topic Classification Worker"
        sleep 2
        run_in_terminal "video-classification-worker.ts" "Video Classification Worker"
        echo -e "${GREEN}All workers started!${NC}"
        echo -e "${YELLOW}Check the individual terminal windows for worker output${NC}"
        echo -e "${YELLOW}Control workers at: http://localhost:3000/dashboard/workers${NC}"
        ;;
    *)
        echo -e "${RED}Unknown worker type: $1${NC}"
        echo ""
        usage
        exit 1
        ;;
esac
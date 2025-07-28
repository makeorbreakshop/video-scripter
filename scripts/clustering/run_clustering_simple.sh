#!/bin/bash

# Simple one-command HDBSCAN runner

cd "$(dirname "$0")"

echo "Installing HDBSCAN dependencies..."
pip3 install hdbscan scikit-learn numpy pandas psycopg2-binary python-dotenv joblib --break-system-packages

echo ""
echo "Running HDBSCAN clustering..."
python3 run_hdbscan_clustering.py
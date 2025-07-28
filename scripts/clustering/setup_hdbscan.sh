#!/bin/bash

echo "Setting up HDBSCAN clustering environment..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install requirements
echo "Installing requirements..."
pip install -r requirements.txt

# Install joblib for model saving
pip install joblib

echo ""
echo "Setup complete! To run HDBSCAN clustering:"
echo "1. Activate the virtual environment: source venv/bin/activate"
echo "2. Run the clustering: python run_hdbscan_clustering.py"
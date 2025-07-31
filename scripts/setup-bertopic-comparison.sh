#!/bin/bash

echo "🔧 Setting up environment for BERTopic comparison..."

# Check if required packages are installed
echo "📦 Checking required Python packages..."

packages=(
    "bertopic"
    "sentence-transformers"
    "umap-learn"
    "hdbscan"
    "pandas"
    "numpy"
    "matplotlib"
    "seaborn"
    "psycopg2-binary"
    "python-dotenv"
)

missing_packages=()

for package in "${packages[@]}"; do
    if ! pip show "$package" > /dev/null 2>&1; then
        missing_packages+=("$package")
    fi
done

if [ ${#missing_packages[@]} -eq 0 ]; then
    echo "✅ All required packages are installed!"
else
    echo "❌ Missing packages: ${missing_packages[*]}"
    echo "📥 Installing missing packages..."
    pip install "${missing_packages[@]}"
fi

echo "
✅ Setup complete!

To run the comparison:
python scripts/bertopic-comparison-title-summary-combined.py

The script will:
1. Fetch 10,000 videos with LLM summaries (adjustable)
2. Run BERTopic clustering on:
   - Titles only
   - LLM summaries only
   - Combined titles + summaries
3. Compare the results and save analysis

Output will be saved to a timestamped directory with:
- Topic assignments for each method
- Topic quality metrics
- Comparison summary
"
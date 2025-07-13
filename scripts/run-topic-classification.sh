#!/bin/bash

# Load environment variables and run topic classification
npx dotenv -e .env -- npx tsx scripts/classify-topics-for-new-videos.js
#!/bin/bash
cd /Users/brandoncullum/video-scripter
export $(cat .env | xargs)
node --import tsx scripts/check-topic-status.js
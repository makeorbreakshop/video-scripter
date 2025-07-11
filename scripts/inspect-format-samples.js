#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test dataset
const dataPath = path.join(__dirname, '..', 'exports', 'format-detection-sample-100-videos-2025-07-11.json');
const videos = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Display sample videos grouped by potential format
console.log('Sample Video Titles by Potential Format:\n');

const formatExamples = {
  'Tutorial': [],
  'Listicle': [],
  'Review': [],
  'Challenge': [],
  'Experiment': [],
  'Explainer': [],
  'Other': []
};

// Categorize videos
videos.forEach(video => {
  const titleLower = video.title.toLowerCase();
  
  if (/^\d+\s+\w+|top\s+\d+|\d+\s+(ways|things|tips|tricks|reasons|facts)/i.test(video.title)) {
    formatExamples['Listicle'].push(video);
  } else if (/^how\s+to|tutorial|guide|step[-\s]by[-\s]step/i.test(titleLower)) {
    formatExamples['Tutorial'].push(video);
  } else if (/review|unboxing|tested|testing|comparison|vs\s+/i.test(titleLower)) {
    formatExamples['Review'].push(video);
  } else if (/challenge|24\s+hour|survive|last\s+to|trying/i.test(titleLower)) {
    formatExamples['Challenge'].push(video);
  } else if (/experiment|what\s+happens|testing.*myth|science\s+experiment/i.test(titleLower)) {
    formatExamples['Experiment'].push(video);
  } else if (/explained|what\s+is|why\s+does|how\s+does|understanding/i.test(titleLower)) {
    formatExamples['Explainer'].push(video);
  } else {
    formatExamples['Other'].push(video);
  }
});

// Display examples
Object.entries(formatExamples).forEach(([format, videos]) => {
  if (videos.length > 0) {
    console.log(`${format} (${videos.length} videos):`);
    videos.slice(0, 5).forEach((video, idx) => {
      console.log(`  ${idx + 1}. "${video.title}" - ${video.channel_name}`);
    });
    if (videos.length > 5) {
      console.log(`  ... and ${videos.length - 5} more\n`);
    } else {
      console.log('');
    }
  }
});

// Show distribution
console.log('Format Distribution:');
Object.entries(formatExamples).forEach(([format, videos]) => {
  const percentage = (videos.length / videos.length * 100).toFixed(1);
  console.log(`  ${format}: ${videos.length} videos`);
});

console.log(`\nTotal videos: ${videos.length}`);
#!/usr/bin/env python3
"""
Clean Video Titles for Better BERTopic Analysis
Removes channel names, common patterns, and format labels to focus on pure content
"""

import pandas as pd
import numpy as np
import json
import re
import os
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class TitleCleaner:
    def __init__(self, data_file_path):
        self.data_file_path = data_file_path
        self.df = None
        
        # Common channel patterns to remove
        self.channel_patterns = [
            # Specific channels we identified
            r'\bbabish\b', r'\bbinging\b', r'\bbasics\b',
            r'\badam savage\b', r'\bsavage\b', r'\badam\b',
            r'\bsteve ramsey\b', r'\bsteve\b',
            r'\bcolinfurze\b', r'\bcolin\b', r'\bfurze\b',
            
            # Generic patterns
            r'\bwith [a-z]+\b',  # "with steve", "with adam"
            r'\b[a-z]+ with\b',  # "basics with", "cooking with"
            r'\bepisode \d+\b',   # "episode 1", "episode 23"
            r'\bep\s*\d+\b',      # "ep 1", "ep23"
            r'\bpart \d+\b',      # "part 1", "part 2"
            r'\bday \d+\b',       # "day 1", "day 12"
            r'\b\d+\s*of\s*\d+\b', # "1 of 5", "3 of 10"
            
            # Format labels
            r'\blive stream\b', r'\bstream\b', r'\blive\b',
            r'\bvlog\b', r'\bupdate\b', r'\bQ&A\b', r'\bqa\b',
            r'\breview\b', r'\bunboxing\b', r'\btutorial\b',
            r'\bguide\b', r'\btips\b', r'\btricks\b',
            r'\bbeginners?\b', r'\badvanced\b',
            
            # Time/date patterns
            r'\b\d{4}\b',         # Years like 2024, 2023
            r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b',
            r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b',
            r'\btoday\b', r'\byesterday\b', r'\btomorrow\b',
            
            # Generic words that don't add content value
            r'\bhow to\b', r'\bdiy\b', r'\bmaking\b', r'\bmake\b',
            r'\bcreating\b', r'\bcreate\b', r'\bbuilding\b', r'\bbuild\b',
            r'\bproject\b', r'\bprojects\b', r'\bideas\b', r'\bidea\b',
            r'\bawesome\b', r'\bamazing\b', r'\bincredible\b', r'\binsane\b',
            r'\bbest\b', r'\btop\b', r'\bultimate\b', r'\bperfect\b',
            r'\beasy\b', r'\bsimple\b', r'\bquick\b', r'\bfast\b',
            r'\bcheap\b', r'\bfree\b', r'\bbudget\b',
            
            # Clickbait patterns
            r'\byou won\'t believe\b', r'\byou need to see\b',
            r'\bthis will\b', r'\bwhy you\b', r'\bwhat happens\b',
            r'\bsecret\b', r'\bhidden\b', r'\bmystery\b',
            r'\bshocking\b', r'\bcrazy\b', r'\bmind.?blowing\b',
        ]
        
        # Common measurement/specification patterns
        self.spec_patterns = [
            r'\b\d+["\' ]*x\s*\d+["\' ]*\b',  # 2" x 4", 12' x 8'
            r'\b\d+\s*x\s*\d+\s*x\s*\d+\b',   # 2 x 4 x 8
            r'\b\d+mm\b', r'\b\d+cm\b', r'\b\d+m\b',  # measurements
            r'\b\d+in\b', r'\b\d+ft\b', r'\b\d+"\b',
            r'\$\d+', r'\b\d+\s*dollars?\b',    # prices
        ]
    
    def load_data(self):
        """Load data from JSON export"""
        logger.info(f"Loading data from {self.data_file_path}")
        
        with open(self.data_file_path, 'r') as f:
            data = json.load(f)
        
        videos = data['videos']
        self.df = pd.DataFrame(videos)
        logger.info(f"Loaded {len(self.df)} videos")
        
        # Keep original titles for comparison
        self.df['original_title'] = self.df['title']
        
    def extract_channel_names(self):
        """Extract actual channel names from the data to create custom patterns"""
        channel_names = self.df['channel_name'].unique()
        logger.info(f"Found {len(channel_names)} unique channels")
        
        # Add common words from channel names to removal patterns
        channel_words = set()
        for channel in channel_names:
            if pd.isna(channel):
                continue
            # Split channel name and add individual words
            words = re.findall(r'\b\w+\b', channel.lower())
            for word in words:
                if len(word) > 2:  # Skip very short words
                    channel_words.add(word)
        
        # Add frequent channel words to patterns (but be selective)
        common_channel_words = [
            'workshop', 'garage', 'studio', 'channel', 'official',
            'diy', 'craft', 'make', 'build', 'wood', 'metal'
        ]
        
        self.channel_patterns.extend([f"\\b{word}\\b" for word in common_channel_words])
        
        logger.info(f"Added {len(common_channel_words)} common channel words to removal patterns")
    
    def clean_title(self, title):
        """Clean a single title"""
        if pd.isna(title):
            return ""
            
        cleaned = title.lower()
        
        # Remove channel patterns
        for pattern in self.channel_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Remove specification patterns (but keep the concept)
        for pattern in self.spec_patterns:
            cleaned = re.sub(pattern, '', cleaned)
        
        # Remove extra punctuation and symbols
        cleaned = re.sub(r'[^\w\s]', ' ', cleaned)
        
        # Remove extra whitespace
        cleaned = re.sub(r'\s+', ' ', cleaned)
        cleaned = cleaned.strip()
        
        # Remove very short words (but keep important ones)
        words = cleaned.split()
        important_short_words = ['3d', 'ai', 'pc', 'tv', 'dj', 'cd', 'usb', 'led', 'cnc', 'pcb']
        filtered_words = [w for w in words if len(w) > 2 or w in important_short_words]
        
        cleaned = ' '.join(filtered_words)
        
        return cleaned if cleaned else title.lower()  # Fallback to original if nothing left
    
    def clean_all_titles(self):
        """Clean all titles in the dataset"""
        logger.info("Extracting channel patterns...")
        self.extract_channel_names()
        
        logger.info("Cleaning all titles...")
        self.df['cleaned_title'] = self.df['title'].apply(self.clean_title)
        
        # Remove entries where cleaning resulted in empty or very short titles
        original_count = len(self.df)
        self.df = self.df[self.df['cleaned_title'].str.len() > 5]
        removed_count = original_count - len(self.df)
        
        logger.info(f"Cleaned {original_count} titles, removed {removed_count} that became too short")
        
        # Show some examples
        logger.info("\nCleaning examples:")
        for i in range(min(10, len(self.df))):
            original = self.df.iloc[i]['original_title']
            cleaned = self.df.iloc[i]['cleaned_title']
            if original != cleaned.title():  # Only show changed ones
                logger.info(f"  Original: {original}")
                logger.info(f"  Cleaned:  {cleaned}")
                logger.info(f"  ---")
    
    def save_cleaned_data(self):
        """Save cleaned dataset"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        
        # Create exports directory if it doesn't exist
        exports_dir = '/Users/brandoncullum/video-scripter/exports'
        os.makedirs(exports_dir, exist_ok=True)
        
        # Save as JSON (same format as original)
        cleaned_data = {
            'export_info': {
                'timestamp': timestamp,
                'total_videos': len(self.df),
                'source': 'cleaned_titles_for_bertopic',
                'dimension': 512,
                'type': 'cleaned_dataset',
                'cleaning_patterns_applied': len(self.channel_patterns)
            },
            'videos': self.df.to_dict('records')
        }
        
        json_file = f"{exports_dir}/cleaned-titles-for-bertopic-{timestamp}.json"
        with open(json_file, 'w') as f:
            json.dump(cleaned_data, f, indent=2)
        
        logger.info(f"💾 Cleaned dataset saved to: {json_file}")
        
        # Save comparison CSV for analysis
        comparison_file = f"{exports_dir}/title-cleaning-comparison-{timestamp}.csv"
        comparison_df = self.df[['id', 'channel_name', 'original_title', 'cleaned_title']].copy()
        comparison_df.to_csv(comparison_file, index=False)
        
        logger.info(f"📊 Title comparison saved to: {comparison_file}")
        
        return json_file
    
    def analyze_cleaning_impact(self):
        """Analyze the impact of cleaning"""
        logger.info("\n" + "=" * 50)
        logger.info("TITLE CLEANING ANALYSIS")
        logger.info("=" * 50)
        
        # Count significantly changed titles
        changed_titles = 0
        for _, row in self.df.iterrows():
            original_words = set(row['original_title'].lower().split())
            cleaned_words = set(row['cleaned_title'].split())
            
            # Consider it changed if more than 20% of words were removed
            if len(original_words - cleaned_words) > len(original_words) * 0.2:
                changed_titles += 1
        
        logger.info(f"Significantly modified: {changed_titles}/{len(self.df)} titles ({changed_titles/len(self.df)*100:.1f}%)")
        
        # Most common removed patterns
        logger.info(f"Applied {len(self.channel_patterns)} cleaning patterns")
        
        # Average title length change
        original_lengths = self.df['original_title'].str.len()
        cleaned_lengths = self.df['cleaned_title'].str.len()
        avg_reduction = (original_lengths.mean() - cleaned_lengths.mean()) / original_lengths.mean() * 100
        
        logger.info(f"Average title length reduction: {avg_reduction:.1f}%")

def main():
    data_file = '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json'
    
    if not os.path.exists(data_file):
        logger.error(f"Data file not found: {data_file}")
        return
    
    # Clean the data
    cleaner = TitleCleaner(data_file)
    cleaner.load_data()
    cleaner.clean_all_titles()
    cleaner.analyze_cleaning_impact()
    
    # Save cleaned dataset
    cleaned_file = cleaner.save_cleaned_data()
    
    logger.info("\n🎯 Cleaning complete!")
    logger.info(f"Next step: Run BERTopic analysis on cleaned data:")
    logger.info(f"python3 scripts/multi-level-bertopic-analysis.py --input {cleaned_file}")

if __name__ == "__main__":
    main()
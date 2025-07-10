#!/usr/bin/env python3
"""
Minimal Title Cleaning for BERTopic Analysis
Only removes channel names from video titles, preserving all format/content patterns
"""

import pandas as pd
import json
import re
import os
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MinimalTitleCleaner:
    def __init__(self, data_file_path):
        self.data_file_path = data_file_path
        self.df = None
        
        # Only channel name patterns - extracted from actual data
        self.channel_patterns = [
            # Specific high-frequency channels we identified
            r'\bbabish\b', r'\bbinging\b', r'\bbasics with babish\b', r'\bbinging with babish\b',
            r'\badam savage\b', r'\badam savages?\b', r'\bsavage\b',
            r'\bsteve ramsey\b', r'\bweekend workshop\b',
            r'\bcolinfurze\b', r'\bcolin furze\b',
            
            # Generic channel name patterns (conservative)
            r'\b\w+ with \w+\b',  # "Basics with Babish", "Cooking with Steve" 
            r'\b\w+\'s \w+\b',    # "Adam's Workshop", "Steve's Garage"
            
            # Channel signature patterns
            r'\[@\w+\]',          # [@channelname] 
            r'\b@\w+\b',          # @channelname
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
        
    def extract_channel_specific_patterns(self):
        """Extract channel-specific patterns from the actual data"""
        logger.info("Analyzing channel names for specific patterns...")
        
        channel_names = self.df['channel_name'].dropna().unique()
        logger.info(f"Found {len(channel_names)} unique channels")
        
        # Add patterns for channels that commonly put their name in titles
        common_title_channels = []
        for channel in channel_names:
            if pd.isna(channel):
                continue
                
            # Check if this channel name appears in video titles
            channel_lower = channel.lower()
            title_mentions = self.df[self.df['channel_name'] == channel]['title'].str.lower().str.contains(channel_lower, na=False).sum()
            
            if title_mentions > 5:  # Channel name appears in 5+ video titles
                common_title_channels.append(channel_lower)
                # Add specific pattern for this channel
                self.channel_patterns.append(f"\\b{re.escape(channel_lower)}\\b")
        
        logger.info(f"Found {len(common_title_channels)} channels that commonly include their name in titles")
        logger.info(f"Examples: {common_title_channels[:5]}")
    
    def clean_title(self, title):
        """Clean a single title - minimal approach"""
        if pd.isna(title):
            return ""
            
        cleaned = title
        
        # Remove channel patterns (case insensitive)
        for pattern in self.channel_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        # Clean up extra whitespace and punctuation artifacts
        cleaned = re.sub(r'\s+', ' ', cleaned)  # Multiple spaces -> single space
        cleaned = re.sub(r'^\s*[:\-\|]\s*', '', cleaned)  # Leading separators
        cleaned = re.sub(r'\s*[:\-\|]\s*$', '', cleaned)  # Trailing separators
        cleaned = cleaned.strip()
        
        return cleaned if cleaned else title  # Fallback to original if nothing left
    
    def clean_all_titles(self):
        """Clean all titles in the dataset"""
        logger.info("Extracting channel-specific patterns...")
        self.extract_channel_specific_patterns()
        
        logger.info("Applying minimal cleaning to all titles...")
        self.df['cleaned_title'] = self.df['title'].apply(self.clean_title)
        
        # Remove entries where cleaning resulted in empty titles
        original_count = len(self.df)
        self.df = self.df[self.df['cleaned_title'].str.len() > 0]
        removed_count = original_count - len(self.df)
        
        logger.info(f"Processed {original_count} titles, removed {removed_count} that became empty")
        
        # Show examples of changes
        logger.info("\nCleaning examples (showing only changed titles):")
        changes_shown = 0
        for i in range(len(self.df)):
            original = self.df.iloc[i]['original_title']
            cleaned = self.df.iloc[i]['cleaned_title']
            if original.lower() != cleaned.lower() and changes_shown < 10:  # Only show changed ones
                logger.info(f"  Original: {original}")
                logger.info(f"  Cleaned:  {cleaned}")
                logger.info(f"  ---")
                changes_shown += 1
    
    def save_cleaned_data(self):
        """Save minimally cleaned dataset"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        
        # Create exports directory if it doesn't exist
        exports_dir = '/Users/brandoncullum/video-scripter/exports'
        os.makedirs(exports_dir, exist_ok=True)
        
        # Save as JSON (same format as original)
        cleaned_data = {
            'export_info': {
                'timestamp': timestamp,
                'total_videos': len(self.df),
                'source': 'minimal_cleaned_titles_for_bertopic',
                'dimension': 512,
                'type': 'minimal_cleaned_dataset',
                'cleaning_approach': 'channel_names_only'
            },
            'videos': self.df.to_dict('records')
        }
        
        json_file = f"{exports_dir}/minimal-cleaned-titles-for-bertopic-{timestamp}.json"
        with open(json_file, 'w') as f:
            json.dump(cleaned_data, f, indent=2)
        
        logger.info(f"💾 Minimally cleaned dataset saved to: {json_file}")
        
        # Save comparison CSV for analysis
        comparison_file = f"{exports_dir}/minimal-title-cleaning-comparison-{timestamp}.csv"
        comparison_df = self.df[['id', 'channel_name', 'original_title', 'cleaned_title']].copy()
        # Only include rows where titles actually changed
        comparison_df = comparison_df[comparison_df['original_title'] != comparison_df['cleaned_title']]
        comparison_df.to_csv(comparison_file, index=False)
        
        logger.info(f"📊 Title comparison (changed only) saved to: {comparison_file}")
        
        return json_file
    
    def analyze_cleaning_impact(self):
        """Analyze the impact of minimal cleaning"""
        logger.info("\n" + "=" * 50)
        logger.info("MINIMAL TITLE CLEANING ANALYSIS")
        logger.info("=" * 50)
        
        # Count changed titles
        changed_titles = (self.df['original_title'] != self.df['cleaned_title']).sum()
        
        logger.info(f"Titles modified: {changed_titles}/{len(self.df)} ({changed_titles/len(self.df)*100:.1f}%)")
        
        # Average title length change
        original_lengths = self.df['original_title'].str.len()
        cleaned_lengths = self.df['cleaned_title'].str.len()
        avg_reduction = (original_lengths.mean() - cleaned_lengths.mean()) / original_lengths.mean() * 100
        
        logger.info(f"Average title length reduction: {avg_reduction:.1f}%")
        logger.info(f"Applied {len(self.channel_patterns)} channel name patterns")

def main():
    data_file = '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json'
    
    if not os.path.exists(data_file):
        logger.error(f"Data file not found: {data_file}")
        return
    
    # Clean the data minimally
    cleaner = MinimalTitleCleaner(data_file)
    cleaner.load_data()
    cleaner.clean_all_titles()
    cleaner.analyze_cleaning_impact()
    
    # Save cleaned dataset
    cleaned_file = cleaner.save_cleaned_data()
    
    logger.info("\n🎯 Minimal cleaning complete!")
    logger.info("Format patterns, content types, and project details preserved.")
    logger.info(f"Ready for BERTopic analysis with: {cleaned_file}")

if __name__ == "__main__":
    main()
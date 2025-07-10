#!/usr/bin/env python3
"""
Improved Title Cleaning for BERTopic Analysis
Removes format indicators, episodes, series names while preserving content themes
"""

import pandas as pd
import json
import re
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ImprovedTitleCleaner:
    def __init__(self, input_file):
        self.input_file = input_file
        self.df = None
        self.channel_patterns = []
        self.format_patterns = []
        self.series_patterns = []
        
    def load_data(self):
        """Load the dataset"""
        logger.info(f"Loading data from {self.input_file}")
        with open(self.input_file, 'r') as f:
            data = json.load(f)
        
        self.df = pd.DataFrame(data['videos'])
        logger.info(f"Loaded {len(self.df)} videos")
        
    def build_cleaning_patterns(self):
        """Build comprehensive cleaning patterns"""
        
        # Channel name patterns (from previous analysis)
        channel_names = [
            'basic with babish', 'adam savage', 'jimmy diresta', 'steve ramsey', 
            'april wilkerson', 'john malecki', 'frank howarth', 'jay bates',
            'matt cremona', 'david picciuto', 'izzy swan', 'colin furze',
            'primitive technology', 'mark rober', 'simone giertz', 'nile red',
            'stuff made here', 'alec steele', 'foresty forest', 'bourbon moth',
            'fisher\'s shop', 'blacktail studio', 'epicfantasy', 'epiccardboardprops',
            'hotmakes', 'sam battle', 'ben eater', 'electroboom', 'bigclivedotcom'
        ]
        
        # Build channel patterns
        self.channel_patterns = []
        for name in channel_names:
            # Direct mentions
            self.channel_patterns.append(rf'\b{re.escape(name)}\b')
            # With parentheses
            self.channel_patterns.append(rf'\({re.escape(name)}\)')
            # Possessive forms
            self.channel_patterns.append(rf'{re.escape(name)}\'s?')
        
        # Episode and series format patterns
        self.format_patterns = [
            # Episode indicators
            r'\bep(?:isode)?\s*#?\d+\b',
            r'\bpart\s*#?\d+\b', 
            r'\bday\s*#?\d+\b',
            r'\bweek\s*#?\d+\b',
            r'\bseason\s*#?\d+\b',
            r'\bseries\s*#?\d+\b',
            r'\b#\d+\b',
            r'\bvol(?:ume)?\s*#?\d+\b',
            
            # Stream indicators
            r'\blive\s*stream\b',
            r'\bstreaming\b',
            r'\blivestream\b',
            r'\bstream\s*#?\d*\b',
            
            # Generic video indicators
            r'\bvideo\s*#?\d*\b',
            r'\bvlog\s*#?\d*\b',
            r'\bupdate\s*#?\d*\b',
            r'\bblog\s*update\b',
            
            # Time/date indicators
            r'\b\d{4}\b',  # Years like 2023, 2024
            r'\bjanuary?\b|\bfebruary?\b|\bmarch?\b|\bapril?\b|\bmay?\b|\bjune?\b',
            r'\bjuly?\b|\baugust?\b|\bseptember?\b|\boctober?\b|\bnovember?\b|\bdecember?\b',
            
            # Measurement units (too generic)
            r'\b\d+\s*(?:mm|cm|inch|inches|ft|feet|min|minutes|hours?|days?)\b',
            
            # Social media indicators
            r'\binstagram\b|\bfacebook\b|\btwitter\b|\btiktok\b|\byoutube\b',
            r'\bfollow\s*me\b|\bsubscribe\b|\blike\s*and\s*subscribe\b',
            
            # Generic exclamations
            r'\bomg\b|\bwow\b|\bamazing\b|\bincredible\b|\bunbelievable\b',
            r'\bmust\s*see\b|\byou\s*won\'t\s*believe\b',
        ]
        
        # Specific series names that are format-focused
        self.series_patterns = [
            r'\bhotmakes\b',
            r'\bsrl\b',
            r'\bmegan\s*hurst\b',
            r'\bdiresta\b',
            r'\bjimmy\s*diresta\b',
            r'\bvlogmas\b',
            r'\bhappy\s*hour\b',
            r'\blaid\s*day\b',
            r'\bsmarter\s*day\b',
            r'\bspicerunnerslounge\b',
            r'\bmakeorbreak\b',
            r'\bpuppet\s*tears\b',
        ]
        
        logger.info(f"Built {len(self.channel_patterns)} channel patterns")
        logger.info(f"Built {len(self.format_patterns)} format patterns") 
        logger.info(f"Built {len(self.series_patterns)} series patterns")
        
    def clean_title(self, title):
        """Clean a single title"""
        if not title or pd.isna(title):
            return title
            
        original_title = title
        cleaned = title.lower()
        
        # Remove channel names
        for pattern in self.channel_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
            
        # Remove format indicators
        for pattern in self.format_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
            
        # Remove series names
        for pattern in self.series_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
            
        # Clean up extra whitespace and punctuation
        cleaned = re.sub(r'\s*[|\-–—:;]\s*', ' ', cleaned)  # Remove separators
        cleaned = re.sub(r'\s*[()[\]{}]\s*', ' ', cleaned)  # Remove brackets
        cleaned = re.sub(r'\s*[!?]{2,}\s*', ' ', cleaned)   # Remove excessive punctuation
        cleaned = re.sub(r'\s+', ' ', cleaned)              # Normalize whitespace
        cleaned = cleaned.strip()
        
        # Don't return empty strings
        if not cleaned or len(cleaned) < 3:
            return original_title
            
        return cleaned
        
    def process_all_titles(self):
        """Process all titles in the dataset"""
        logger.info("Cleaning all video titles...")
        
        self.df['original_title'] = self.df['title'].copy()
        self.df['improved_cleaned_title'] = self.df['title'].apply(self.clean_title)
        
        # Calculate cleaning statistics
        original_lengths = self.df['title'].str.len()
        cleaned_lengths = self.df['improved_cleaned_title'].str.len()
        
        modified_count = (self.df['title'] != self.df['improved_cleaned_title']).sum()
        avg_length_reduction = ((original_lengths - cleaned_lengths) / original_lengths * 100).mean()
        
        logger.info(f"Modified {modified_count:,} titles ({modified_count/len(self.df)*100:.1f}%)")
        logger.info(f"Average length reduction: {avg_length_reduction:.1f}%")
        
        # Show examples
        logger.info("\nCleaning examples:")
        examples = self.df[self.df['title'] != self.df['improved_cleaned_title']].head(10)
        for _, row in examples.iterrows():
            logger.info(f"  Before: {row['title']}")
            logger.info(f"  After:  {row['improved_cleaned_title']}")
            logger.info("")
            
    def save_cleaned_data(self):
        """Save the cleaned dataset"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        output_file = f'/Users/brandoncullum/video-scripter/exports/improved-cleaned-titles-{timestamp}.json'
        
        # Prepare output data
        output_data = {
            'videos': self.df.to_dict('records'),
            'metadata': {
                'original_count': len(self.df),
                'timestamp': timestamp,
                'cleaning_type': 'improved_format_and_series_removal'
            }
        }
        
        with open(output_file, 'w') as f:
            json.dump(output_data, f, indent=2, default=str)
            
        logger.info(f"💾 Improved cleaned dataset saved to: {output_file}")
        return output_file
        
    def run(self):
        """Run the complete cleaning process"""
        logger.info("🚀 Starting Improved Title Cleaning")
        
        self.load_data()
        self.build_cleaning_patterns()
        self.process_all_titles()
        output_file = self.save_cleaned_data()
        
        logger.info("✅ Improved cleaning complete!")
        logger.info(f"📁 Output: {output_file}")
        logger.info("🎯 Ready for improved BERTopic analysis")
        
        return output_file

if __name__ == "__main__":
    import sys
    
    # Use existing dataset
    input_file = '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json'
    
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
        
    cleaner = ImprovedTitleCleaner(input_file)
    cleaner.run()
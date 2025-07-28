#!/usr/bin/env python3

"""
Alternative Transcript Fetcher using youtube-transcript-api
Much faster than scraping YouTube pages directly

Features:
- Uses youtube-transcript-api library (no scraping)
- Batch processing with multiprocessing
- Handles multiple languages
- Automatic fallback to auto-generated captions
- Direct database insertion
- Progress tracking and resumption
"""

import os
import json
import time
import logging
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List, Dict, Optional, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
import uuid
from tqdm import tqdm

# Configuration
CONFIG = {
    'DATABASE_URL': os.environ.get('DATABASE_URL', ''),
    'BATCH_SIZE': 100,
    'MAX_WORKERS': 8,  # Number of parallel processes
    'CHUNK_SIZE': 1000,  # Words per chunk
    'CHUNK_OVERLAP': 100,  # Word overlap
    'PROGRESS_FILE': 'transcript_progress_v2.json',
    'ERROR_LOG': 'transcript_errors_v2.log',
    'LANGUAGE_PREFERENCE': ['en', 'en-US', 'en-GB'],  # Preferred languages
}

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(CONFIG['ERROR_LOG']),
        logging.StreamHandler()
    ]
)

class TranscriptFetcher:
    def __init__(self):
        self.progress = self.load_progress()
        self.stats = {
            'processed': 0,
            'successful': 0,
            'failed': 0,
            'no_transcript': 0,
            'already_exists': 0
        }
    
    def load_progress(self) -> Dict:
        """Load progress from file if exists"""
        try:
            with open(CONFIG['PROGRESS_FILE'], 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return {
                'last_video_id': None,
                'total_processed': 0,
                'timestamp': None
            }
    
    def save_progress(self, last_video_id: str):
        """Save current progress"""
        self.progress['last_video_id'] = last_video_id
        self.progress['total_processed'] = self.stats['processed']
        self.progress['timestamp'] = datetime.now().isoformat()
        
        with open(CONFIG['PROGRESS_FILE'], 'w') as f:
            json.dump(self.progress, f, indent=2)
    
    def get_transcript(self, video_id: str) -> Optional[List[Dict]]:
        """Fetch transcript for a single video"""
        try:
            # Try to get transcript with language preference
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # First try manual transcripts in preferred languages
            for lang in CONFIG['LANGUAGE_PREFERENCE']:
                try:
                    transcript = transcript_list.find_manually_created_transcript([lang])
                    return transcript.fetch()
                except:
                    continue
            
            # Fallback to auto-generated in preferred languages
            for lang in CONFIG['LANGUAGE_PREFERENCE']:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    return transcript.fetch()
                except:
                    continue
            
            # Last resort: any available transcript
            for transcript in transcript_list:
                return transcript.fetch()
            
            return None
            
        except (NoTranscriptFound, TranscriptsDisabled):
            return None
        except Exception as e:
            logging.error(f"Error fetching transcript for {video_id}: {str(e)}")
            return None
    
    def format_transcript(self, transcript_data: List[Dict]) -> str:
        """Convert transcript data to text"""
        return ' '.join([entry['text'] for entry in transcript_data])
    
    def chunk_transcript(self, text: str, video_id: str, user_id: str) -> List[Dict]:
        """Split transcript into chunks"""
        words = text.split()
        chunks = []
        
        for i in range(0, len(words), CONFIG['CHUNK_SIZE'] - CONFIG['CHUNK_OVERLAP']):
            chunk_words = words[i:i + CONFIG['CHUNK_SIZE']]
            
            if len(chunk_words) > 50:  # Minimum chunk size
                chunks.append({
                    'id': str(uuid.uuid4()),
                    'video_id': video_id,
                    'user_id': user_id,
                    'content': ' '.join(chunk_words),
                    'content_type': 'transcript',
                    'metadata': json.dumps({
                        'chunk_index': len(chunks),
                        'word_count': len(chunk_words),
                        'bulk_import': True,
                        'import_method': 'youtube-transcript-api',
                        'import_date': datetime.now().isoformat()
                    })
                })
        
        return chunks
    
    def process_video_batch(self, videos: List[Dict]) -> Dict[str, int]:
        """Process a batch of videos"""
        batch_stats = {
            'successful': 0,
            'failed': 0,
            'no_transcript': 0,
            'already_exists': 0
        }
        
        # Connect to database
        conn = psycopg2.connect(CONFIG['DATABASE_URL'])
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        try:
            for video in videos:
                video_id = video['id']
                user_id = video['user_id']
                
                # Check if transcript already exists
                cur.execute("""
                    SELECT COUNT(*) as count 
                    FROM chunks 
                    WHERE video_id = %s AND content_type = 'transcript'
                """, (video_id,))
                
                if cur.fetchone()['count'] > 0:
                    batch_stats['already_exists'] += 1
                    continue
                
                # Fetch transcript
                transcript_data = self.get_transcript(video_id)
                
                if not transcript_data:
                    batch_stats['no_transcript'] += 1
                    continue
                
                # Format and chunk transcript
                text = self.format_transcript(transcript_data)
                chunks = self.chunk_transcript(text, video_id, user_id)
                
                if chunks:
                    # Bulk insert chunks
                    insert_query = """
                        INSERT INTO chunks (id, video_id, user_id, content, content_type, metadata)
                        VALUES %s
                    """
                    
                    values = [
                        (c['id'], c['video_id'], c['user_id'], c['content'], 
                         c['content_type'], c['metadata'])
                        for c in chunks
                    ]
                    
                    execute_values(cur, insert_query, values)
                    conn.commit()
                    
                    batch_stats['successful'] += 1
                else:
                    batch_stats['failed'] += 1
            
        except Exception as e:
            logging.error(f"Batch processing error: {str(e)}")
            conn.rollback()
        finally:
            cur.close()
            conn.close()
        
        return batch_stats
    
    def run(self):
        """Main execution loop"""
        conn = psycopg2.connect(CONFIG['DATABASE_URL'])
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Count total videos
        cur.execute("SELECT COUNT(*) as total FROM videos")
        total_videos = cur.fetchone()['total']
        
        print(f"📊 Total videos in database: {total_videos:,}")
        print(f"🔄 Starting from: {self.progress.get('last_video_id', 'beginning')}")
        
        processed = 0
        
        with ProcessPoolExecutor(max_workers=CONFIG['MAX_WORKERS']) as executor:
            while True:
                # Fetch batch of videos
                query = """
                    SELECT id, user_id, title, channel_id
                    FROM videos
                    WHERE 1=1
                """
                
                if self.progress['last_video_id']:
                    query += f" AND id > '{self.progress['last_video_id']}'"
                
                query += f" ORDER BY id LIMIT {CONFIG['BATCH_SIZE'] * CONFIG['MAX_WORKERS']}"
                
                cur.execute(query)
                videos = cur.fetchall()
                
                if not videos:
                    break
                
                # Split into batches for parallel processing
                batches = [videos[i:i + CONFIG['BATCH_SIZE']] 
                          for i in range(0, len(videos), CONFIG['BATCH_SIZE'])]
                
                # Process batches in parallel
                futures = []
                for batch in batches:
                    future = executor.submit(self.process_video_batch, batch)
                    futures.append(future)
                
                # Collect results
                for future in tqdm(as_completed(futures), total=len(futures), 
                                 desc="Processing batches"):
                    batch_stats = future.result()
                    
                    # Update statistics
                    for key, value in batch_stats.items():
                        self.stats[key] += value
                
                # Update progress
                processed += len(videos)
                self.stats['processed'] = processed
                last_video_id = videos[-1]['id']
                self.save_progress(last_video_id)
                
                # Display progress
                success_rate = (self.stats['successful'] / processed * 100) if processed > 0 else 0
                print(f"""
⏱️  Progress: {processed:,} / {total_videos:,} ({processed/total_videos*100:.1f}%)
✅ Successful: {self.stats['successful']:,} ({success_rate:.1f}%)
❌ Failed: {self.stats['failed']:,}
🚫 No transcript: {self.stats['no_transcript']:,}
⏭️  Already exists: {self.stats['already_exists']:,}
                """)
                
                # Small delay to avoid overwhelming the system
                time.sleep(1)
        
        cur.close()
        conn.close()
        
        print(f"""
🎉 Transcript fetching complete!
Total processed: {self.stats['processed']:,}
Successful: {self.stats['successful']:,}
Failed: {self.stats['failed']:,}
No transcript available: {self.stats['no_transcript']:,}
Already had transcripts: {self.stats['already_exists']:,}
        """)

def main():
    """Main entry point"""
    if not CONFIG['DATABASE_URL']:
        print("❌ DATABASE_URL environment variable not set")
        print("Set it using: export DATABASE_URL='postgresql://...'")
        return
    
    print("""
🚀 YouTube Transcript Bulk Fetcher
==================================
This script uses youtube-transcript-api for fast, reliable transcript fetching.

Requirements:
pip install youtube-transcript-api psycopg2-binary tqdm

Press Ctrl+C to stop and resume later.
    """)
    
    fetcher = TranscriptFetcher()
    
    try:
        fetcher.run()
    except KeyboardInterrupt:
        print("\n\n⏸️  Paused! Progress saved. Run again to resume.")
        fetcher.save_progress(fetcher.progress.get('last_video_id', ''))

if __name__ == "__main__":
    main()
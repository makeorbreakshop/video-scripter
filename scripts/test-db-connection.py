import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_connection():
    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    
    print(f"URL: {url}")
    print(f"Service key exists: {bool(service_key)}")
    
    if url and 'supabase.co' in url:
        # Extract project ref from Supabase URL
        project_ref = url.split('//')[1].split('.')[0]
        
        # Try different connection methods
        connection_strings = [
            f"postgresql://postgres.{project_ref}:{service_key}@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
            f"postgresql://postgres:{service_key}@db.{project_ref}.supabase.co:5432/postgres"
        ]
        
        for i, conn_str in enumerate(connection_strings):
            try:
                print(f"\nTrying connection method {i+1}...")
                conn = psycopg2.connect(conn_str)
                cur = conn.cursor()
                
                # Test query
                cur.execute("SELECT COUNT(*) FROM videos WHERE llm_summary IS NOT NULL AND llm_summary_embedding_synced = true")
                count = cur.fetchone()[0]
                
                print(f"✅ Connection successful! Found {count:,} videos with LLM summaries")
                cur.close()
                conn.close()
                return conn_str
                
            except Exception as e:
                print(f"❌ Failed: {e}")
                continue
        
        print("❌ All connection methods failed")
        return None
    else:
        print("❌ Invalid Supabase URL")
        return None

if __name__ == "__main__":
    test_connection()
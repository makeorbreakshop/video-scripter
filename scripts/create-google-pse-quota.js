const { Client } = require('pg');
require('dotenv').config();

async function createGooglePSEQuota() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_pse_quota (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        searches_used INTEGER NOT NULL DEFAULT 0,
        max_daily_quota INTEGER NOT NULL DEFAULT 100,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
      )
    `);
    console.log('✅ Created google_pse_quota table');

    // Create index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_google_pse_quota_date ON google_pse_quota(date)
    `);
    console.log('✅ Created index on date column');

    // Create increment function
    await client.query(`
      CREATE OR REPLACE FUNCTION increment_google_pse_quota()
      RETURNS INTEGER AS $$
      DECLARE
        current_date DATE := CURRENT_DATE;
        current_used INTEGER;
      BEGIN
        -- Insert or update today's quota
        INSERT INTO google_pse_quota (date, searches_used)
        VALUES (current_date, 1)
        ON CONFLICT (date) 
        DO UPDATE SET 
          searches_used = google_pse_quota.searches_used + 1,
          updated_at = TIMEZONE('utc', NOW());
        
        -- Return the current usage
        SELECT searches_used INTO current_used
        FROM google_pse_quota
        WHERE date = current_date;
        
        RETURN current_used;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('✅ Created increment_google_pse_quota function');

    // Create status function
    await client.query(`
      CREATE OR REPLACE FUNCTION get_google_pse_quota_status()
      RETURNS TABLE(
        used INTEGER,
        remaining INTEGER,
        total INTEGER
      ) AS $$
      DECLARE
        current_date DATE := CURRENT_DATE;
        quota_used INTEGER;
        quota_max INTEGER;
      BEGIN
        -- Get or create today's quota record
        INSERT INTO google_pse_quota (date, searches_used)
        VALUES (current_date, 0)
        ON CONFLICT (date) DO NOTHING;
        
        -- Get current values
        SELECT searches_used, max_daily_quota 
        INTO quota_used, quota_max
        FROM google_pse_quota
        WHERE date = current_date;
        
        RETURN QUERY SELECT 
          COALESCE(quota_used, 0) as used,
          COALESCE(quota_max - quota_used, 100) as remaining,
          COALESCE(quota_max, 100) as total;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('✅ Created get_google_pse_quota_status function');

    // Test the functions
    const statusResult = await client.query('SELECT * FROM get_google_pse_quota_status()');
    console.log('\n📊 Current quota status:', statusResult.rows[0]);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

createGooglePSEQuota();
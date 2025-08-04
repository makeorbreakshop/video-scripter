#!/bin/bash

# Direct PostgreSQL update script
# This bypasses Supabase timeouts by connecting directly

echo "Starting direct PostgreSQL hierarchy update..."

# Connection string from your .env
DATABASE_URL="postgres://postgres.mhzwrynnfphlxqcqytrj:VnQK7jhKQJOT73H5@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

# Create all updates in a single transaction
/opt/homebrew/opt/postgresql@16/bin/psql "$DATABASE_URL" << 'EOF'
BEGIN;

-- Show progress
\echo 'Updating DIY & Crafts clusters...'

-- DIY & Crafts > Woodworking
UPDATE videos SET topic_niche = 'Woodworking' 
WHERE topic_cluster_id IN (0, 15, 51, 64, 124, 153, 173, 178, 185) 
AND bertopic_version = 'v1_2025-08-01';

-- DIY & Crafts > Metalworking
UPDATE videos SET topic_niche = 'Metalworking'
WHERE topic_cluster_id IN (57, 167, 170)
AND bertopic_version = 'v1_2025-08-01';

-- DIY & Crafts > Workshop
UPDATE videos SET topic_niche = 'Workshop'
WHERE topic_cluster_id IN (176, 179, 191, 196, 210, 214)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating Technology clusters...'

-- Technology > Programming
UPDATE videos SET topic_niche = 'Programming'
WHERE topic_cluster_id IN (59, 165, 175, 183)
AND bertopic_version = 'v1_2025-08-01';

-- Technology > Photography & Video
UPDATE videos SET topic_niche = 'Photography & Video'
WHERE topic_cluster_id IN (12, 41, 114, 143)
AND bertopic_version = 'v1_2025-08-01';

-- Technology > Electronics
UPDATE videos SET topic_niche = 'Electronics'
WHERE topic_cluster_id IN (112, 132, 155, 159)
AND bertopic_version = 'v1_2025-08-01';

-- Technology > 3D Printing
UPDATE videos SET topic_niche = '3D Printing'
WHERE topic_cluster_id IN (22, 97)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating Business clusters...'

-- Business > Digital Marketing
UPDATE videos SET topic_niche = 'Digital Marketing'
WHERE topic_cluster_id IN (9, 14, 34, 201)
AND bertopic_version = 'v1_2025-08-01';

-- Business > E-commerce
UPDATE videos SET topic_niche = 'E-commerce'
WHERE topic_cluster_id IN (42, 68, 158, 193)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating Music clusters...'

-- Music > Music Production
UPDATE videos SET topic_niche = 'Music Production'
WHERE topic_cluster_id IN (29, 79, 83, 89)
AND bertopic_version = 'v1_2025-08-01';

-- Music > Instruments
UPDATE videos SET topic_niche = 'Instruments'
WHERE topic_cluster_id IN (6, 63, 85, 91, 166)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating Gaming clusters...'

-- Gaming > Gameplay (all gaming topics)
UPDATE videos SET topic_niche = 'Gameplay'
WHERE topic_cluster_id IN (18, 20, 93, 99, 109, 111, 135, 163)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating Lifestyle clusters...'

-- Lifestyle > Home & Organization
UPDATE videos SET topic_niche = 'Home & Organization'
WHERE topic_cluster_id IN (2, 36, 117, 160, 169)
AND bertopic_version = 'v1_2025-08-01';

-- Lifestyle > Alternative Living
UPDATE videos SET topic_niche = 'Alternative Living'
WHERE topic_cluster_id IN (4, 125, 198)
AND bertopic_version = 'v1_2025-08-01';

\echo 'Updating outliers...'

-- Handle outliers
UPDATE videos SET 
  topic_domain = 'Outlier',
  topic_niche = 'Outlier',
  topic_micro = 'Outlier'
WHERE topic_cluster_id = -1
AND bertopic_version = 'v1_2025-08-01';

\echo 'Committing changes...'
COMMIT;

\echo 'Update complete! Showing summary...'

-- Show summary
SELECT 
  topic_domain,
  topic_niche,
  COUNT(*) as video_count
FROM videos
WHERE bertopic_version = 'v1_2025-08-01'
GROUP BY topic_domain, topic_niche
ORDER BY topic_domain, topic_niche
LIMIT 20;

\echo 'Done! Remember to refresh the materialized view.'
EOF

echo "Script complete!"
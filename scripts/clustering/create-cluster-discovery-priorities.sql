-- Create cluster discovery priorities table
CREATE TABLE IF NOT EXISTS cluster_discovery_priorities (
    cluster_id INT PRIMARY KEY,
    priority_score INT NOT NULL DEFAULT 0,
    is_underrepresented BOOLEAN DEFAULT false,
    is_growing BOOLEAN DEFAULT false,
    effectiveness_score INT DEFAULT 0,
    last_discovery_run TIMESTAMP,
    videos_discovered_30d INT DEFAULT 0,
    channels_discovered_30d INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for priority queries
CREATE INDEX IF NOT EXISTS idx_cluster_priority_score 
ON cluster_discovery_priorities(priority_score DESC);

-- Function to create the table if it doesn't exist
CREATE OR REPLACE FUNCTION create_cluster_discovery_priorities_if_not_exists()
RETURNS void AS $$
BEGIN
    CREATE TABLE IF NOT EXISTS cluster_discovery_priorities (
        cluster_id INT PRIMARY KEY,
        priority_score INT NOT NULL DEFAULT 0,
        is_underrepresented BOOLEAN DEFAULT false,
        is_growing BOOLEAN DEFAULT false,
        effectiveness_score INT DEFAULT 0,
        last_discovery_run TIMESTAMP,
        videos_discovered_30d INT DEFAULT 0,
        channels_discovered_30d INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_cluster_priority_score 
    ON cluster_discovery_priorities(priority_score DESC);
END;
$$ LANGUAGE plpgsql;

-- Table to store cluster coverage reports
CREATE TABLE IF NOT EXISTS cluster_coverage_reports (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    data JSONB NOT NULL,
    report_type VARCHAR(50) DEFAULT 'coverage',
    summary JSONB
);

-- View for current cluster priorities
CREATE OR REPLACE VIEW current_cluster_priorities AS
SELECT 
    p.*,
    m.name as cluster_name,
    m.video_count,
    m.avg_views,
    m.keywords
FROM cluster_discovery_priorities p
LEFT JOIN cluster_metadata m ON p.cluster_id = m.cluster_id
ORDER BY p.priority_score DESC;
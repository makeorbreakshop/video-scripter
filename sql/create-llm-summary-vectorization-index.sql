-- Index to optimize LLM summary vectorization worker query
-- This index supports the query that fetches videos with LLM summaries that haven't been vectorized yet
-- The partial index (WHERE clause) reduces index size by only including rows that match the query condition

CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_vectorization 
ON videos (llm_summary_embedding_synced, id) 
WHERE llm_summary IS NOT NULL;

-- This composite index on (llm_summary_embedding_synced, id) helps because:
-- 1. The query filters on llm_summary_embedding_synced = false
-- 2. The query uses id for pagination (id > lastId)
-- 3. The WHERE clause matches the query's NOT NULL condition on llm_summary
-- 4. The ORDER BY id is supported by having id in the index
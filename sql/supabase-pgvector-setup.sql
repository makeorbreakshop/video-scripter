-- Enable the pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Test that the extension is working with a simple vector operation
SELECT '[1,2,3]'::vector;

-- Output: [1,2,3]
-- If you see this output, pgvector is successfully installed 
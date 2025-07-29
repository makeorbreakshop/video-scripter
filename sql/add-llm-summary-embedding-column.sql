-- Add column to track when LLM summary embeddings were synced to Pinecone
ALTER TABLE public.videos 
ADD COLUMN IF NOT EXISTS llm_summary_embedding_synced BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_embedding_synced 
ON public.videos(llm_summary_embedding_synced);

-- Create index for finding videos that need embeddings
CREATE INDEX IF NOT EXISTS idx_videos_need_summary_embeddings 
ON public.videos(id) 
WHERE llm_summary IS NOT NULL 
AND (llm_summary_embedding_synced IS NULL OR llm_summary_embedding_synced = FALSE);
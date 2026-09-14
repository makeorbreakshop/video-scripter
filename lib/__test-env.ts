// Env stubs so the service modules under test can be imported at all: several of them build
// Supabase / OpenAI / Pinecone clients at module scope and throw without these.
export function stubServiceEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
  process.env.OPENAI_API_KEY ||= 'test';
  process.env.PINECONE_API_KEY ||= 'test';
  process.env.PINECONE_INDEX_NAME ||= 'test';
  process.env.PINECONE_THUMBNAIL_INDEX_NAME ||= 'test';
  process.env.PINECONE_SUMMARY_INDEX_NAME ||= 'test';
  process.env.REPLICATE_API_TOKEN ||= 'test';
  process.env.YOUTUBE_API_KEY ||= 'test';
  process.env.DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
}

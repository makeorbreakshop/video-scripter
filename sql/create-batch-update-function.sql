-- Create function for batch updating LLM summaries
CREATE OR REPLACE FUNCTION batch_update_llm_summaries(updates jsonb)
RETURNS void AS $$
DECLARE
  update_record jsonb;
BEGIN
  FOR update_record IN SELECT * FROM jsonb_array_elements(updates)
  LOOP
    UPDATE videos
    SET 
      llm_summary = update_record->>'llm_summary',
      llm_summary_generated_at = (update_record->>'llm_summary_generated_at')::timestamp with time zone
    WHERE id = update_record->>'id';
  END LOOP;
END;
$$ LANGUAGE plpgsql;
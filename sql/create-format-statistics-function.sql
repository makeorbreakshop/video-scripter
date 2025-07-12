-- Create a function to efficiently get format statistics
CREATE OR REPLACE FUNCTION get_format_statistics()
RETURNS TABLE (
  format_type text,
  count bigint,
  avg_confidence numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.format_type,
    COUNT(*)::bigint as count,
    AVG(v.format_confidence) as avg_confidence
  FROM videos v
  WHERE v.format_type IS NOT NULL
  GROUP BY v.format_type
  
  UNION ALL
  
  -- Add a summary row with overall average confidence
  SELECT 
    'TOTAL_AVG' as format_type,
    0::bigint as count,
    AVG(v.format_confidence) as avg_confidence
  FROM videos v
  WHERE v.format_type IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
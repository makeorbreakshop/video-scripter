# Executing Skyscraper Schema in Supabase

You can apply the Skyscraper Analysis Framework database schema in several ways:

## Option 1: Using the Supabase SQL Editor (Recommended)

1. Log in to your Supabase dashboard at [https://app.supabase.com/](https://app.supabase.com/)
2. Navigate to your project
3. Click on "SQL Editor" in the left sidebar
4. Click "New Query" button
5. Copy the entire contents of the `sql/skyscraper-schema.sql` file
6. Paste it into the SQL editor
7. Click "Run" to execute all the SQL commands at once

If you encounter errors, you may need to execute the statements in smaller batches.

## Option 2: Using the Supabase CLI

If you have the Supabase CLI installed, you can execute the SQL file using:

```bash
supabase db execute --project-ref your-project-ref --file sql/skyscraper-schema.sql
```

Replace `your-project-ref` with your actual Supabase project reference ID.

## Option 3: Using a Node.js Script (Requires Additional Setup)

1. First, create a helper function in Supabase by running this SQL in the SQL Editor:

```sql
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_query;
  RETURN 'SQL executed successfully';
END;
$$;
```

2. Add your service role key to `.env.local`:
```
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

3. Run the provided script:
```bash
node setup-skyscraper-schema-simple.js
```

## Verifying the Schema

After executing the SQL, you can verify that the tables were created by:

1. Going to the "Table Editor" in your Supabase dashboard
2. You should see the new tables:
   - content_analysis
   - audience_analysis
   - content_gaps
   - structure_elements
   - engagement_techniques
   - value_delivery
   - implementation_blueprint
   - skyscraper_analysis_progress

3. You can also check that the new columns were added to the videos table:
   - outlier_factor
   - niche 
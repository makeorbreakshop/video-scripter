# Setting Up Direct Database Connection

## Steps to Get Your Database URL

1. **Go to Supabase Dashboard**
   - Navigate to your project: https://supabase.com/dashboard/project/mhzwrynnfphlxqcqytrj

2. **Get Connection String**
   - Go to **Settings** → **Database**
   - Under **Connection String**, you'll see several options:
     - **URI** - This is what you need
     - **PSQL** - Command line format
     - **Golang**, **JDBC**, etc.

3. **Choose Connection Type**
   - **Session mode** (Port 5432) - Direct connection, no pooling
   - **Transaction mode** (Port 6543) - Pooled connection, recommended

4. **Copy the URI**
   It will look like:
   ```
   postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```

5. **Add to .env file**
   ```bash
   DATABASE_URL=postgresql://postgres.mhzwrynnfphlxqcqytrj:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres
   ```

## Alternative: Use Supabase Service Role Key

If you don't want to expose the database password, you can use the Node.js script with your existing Supabase credentials:

```bash
node scripts/direct-db-update.js
```

This will use your SUPABASE_SERVICE_ROLE_KEY which you already have configured.
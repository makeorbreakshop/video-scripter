/**
 * Direct SQL execution endpoint for bypassing Supabase client limits
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json(
        { error: 'SQL query is required' },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      const result = await client.query(query);
      return NextResponse.json({
        success: true,
        data: result.rows,
        count: result.rowCount
      });
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('SQL execution error:', error);
    return NextResponse.json(
      { error: 'SQL execution failed' },
      { status: 500 }
    );
  }
}
import { NextResponse } from 'next/server';

export async function GET() {
  // For now, return empty results
  // In production, this would fetch from database
  return NextResponse.json({
    success: true,
    results: []
  });
}
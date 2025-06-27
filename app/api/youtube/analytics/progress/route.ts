import { NextRequest, NextResponse } from 'next/server';

/**
 * Global progress tracking for YouTube Analytics operations
 * Supports multiple concurrent operations with unique identifiers
 */
interface ProgressEntry {
  id: string;
  operation: string;
  startTime: number;
  lastUpdateTime: number;
  progress: any;
  isActive: boolean;
}

// In-memory progress store (consider Redis for production)
const progressStore = new Map<string, ProgressEntry>();

/**
 * GET /api/youtube/analytics/progress?id={operationId}
 * Get real-time progress for a specific operation
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const operationId = searchParams.get('id');
    
    if (!operationId) {
      // Return all active operations
      const activeOperations = Array.from(progressStore.values())
        .filter(entry => entry.isActive)
        .map(entry => ({
          id: entry.id,
          operation: entry.operation,
          startTime: entry.startTime,
          lastUpdateTime: entry.lastUpdateTime,
          duration: entry.lastUpdateTime - entry.startTime,
          progress: entry.progress
        }));
      
      return NextResponse.json({
        success: true,
        activeOperations,
        count: activeOperations.length
      });
    }
    
    const entry = progressStore.get(operationId);
    if (!entry) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      operation: {
        id: entry.id,
        operation: entry.operation,
        startTime: entry.startTime,
        lastUpdateTime: entry.lastUpdateTime,
        duration: entry.lastUpdateTime - entry.startTime,
        isActive: entry.isActive,
        progress: entry.progress
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch progress' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/youtube/analytics/progress
 * Update progress for an operation
 */
export async function POST(request: NextRequest) {
  try {
    const { operationId, operation, progress, isActive = true } = await request.json();
    
    if (!operationId) {
      return NextResponse.json(
        { error: 'Operation ID is required' },
        { status: 400 }
      );
    }
    
    const now = Date.now();
    const existing = progressStore.get(operationId);
    
    const entry: ProgressEntry = {
      id: operationId,
      operation: operation || existing?.operation || 'Unknown Operation',
      startTime: existing?.startTime || now,
      lastUpdateTime: now,
      progress,
      isActive
    };
    
    progressStore.set(operationId, entry);
    
    // Clean up old inactive operations (older than 1 hour)
    const oneHourAgo = now - (60 * 60 * 1000);
    for (const [id, entry] of progressStore.entries()) {
      if (!entry.isActive && entry.lastUpdateTime < oneHourAgo) {
        progressStore.delete(id);
      }
    }
    
    return NextResponse.json({
      success: true,
      operationId,
      timestamp: now
    });
    
  } catch (error) {
    console.error('❌ Error updating progress:', error);
    return NextResponse.json(
      { error: 'Failed to update progress' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/youtube/analytics/progress?id={operationId}
 * Mark an operation as completed and clean up
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const operationId = searchParams.get('id');
    
    if (!operationId) {
      return NextResponse.json(
        { error: 'Operation ID is required' },
        { status: 400 }
      );
    }
    
    const entry = progressStore.get(operationId);
    if (entry) {
      entry.isActive = false;
      entry.lastUpdateTime = Date.now();
      progressStore.set(operationId, entry);
    }
    
    return NextResponse.json({
      success: true,
      operationId,
      message: 'Operation marked as completed'
    });
    
  } catch (error) {
    console.error('❌ Error completing operation:', error);
    return NextResponse.json(
      { error: 'Failed to complete operation' },
      { status: 500 }
    );
  }
}
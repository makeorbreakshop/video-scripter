import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCanvas, loadImage } from 'canvas';

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoIds } = body;

    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json({ error: 'Video IDs are required' }, { status: 400 });
    }

    // Limit to 30 videos for reasonable grid size
    const limitedIds = videoIds.slice(0, 30);

    // Fetch video details
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, channel_name, view_count')
      .in('id', limitedIds);

    if (error || !videos) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 500 });
    }

    // Sort videos to match the order of videoIds
    const sortedVideos = limitedIds
      .map(id => videos.find(v => v.id === id))
      .filter(Boolean);

    // Grid configuration
    const thumbnailWidth = 320;
    const thumbnailHeight = 180;
    const padding = 10;
    const cols = 5;
    const rows = Math.ceil(sortedVideos.length / cols);

    // Calculate canvas size
    const canvasWidth = (thumbnailWidth + padding) * cols + padding;
    const canvasHeight = (thumbnailHeight + padding) * rows + padding;

    // Create canvas
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw thumbnails in grid
    try {
      for (let i = 0; i < sortedVideos.length; i++) {
        const video = sortedVideos[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * (thumbnailWidth + padding) + padding;
        const y = row * (thumbnailHeight + padding) + padding;

        try {
          // Load and draw thumbnail
          const image = await loadImage(video.thumbnail_url);
          ctx.drawImage(image, x, y, thumbnailWidth, thumbnailHeight);

          // Add subtle border
          ctx.strokeStyle = '#E5E5E5';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, thumbnailWidth, thumbnailHeight);

        } catch (imgError) {
          // If thumbnail fails to load, show placeholder
          ctx.fillStyle = '#F3F4F6';
          ctx.fillRect(x, y, thumbnailWidth, thumbnailHeight);
          ctx.fillStyle = '#9CA3AF';
          ctx.font = '14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Thumbnail unavailable', x + thumbnailWidth / 2, y + thumbnailHeight / 2);
          ctx.textAlign = 'left';
        }
      }

      // Add watermark
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.font = '12px Arial';
      ctx.fillText(`Pattern Analysis - ${new Date().toLocaleDateString()} - ${sortedVideos.length} videos`, padding, canvasHeight - padding);

    } catch (error) {
      console.error('Error creating thumbnail grid:', error);
    }

    // Convert canvas to buffer
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });

    // Return image
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="pattern-analysis-${new Date().toISOString().split('T')[0]}.jpg"`
      }
    });

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export analysis grid' },
      { status: 500 }
    );
  }
}
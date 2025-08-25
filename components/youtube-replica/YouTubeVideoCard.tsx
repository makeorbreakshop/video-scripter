'use client';

import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';

interface VideoCardProps {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  duration: string;
  className?: string;
}

// Helper function to format view count
function formatViewCount(count: number): string {
  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1)}B`;
  } else if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

// Helper function to format duration
function formatDuration(duration: string): string {
  // Convert ISO 8601 duration (PT3M34S) to readable format (3:34)
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return duration;
  
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function YouTubeVideoCard({
  id,
  title,
  thumbnail_url,
  channel_name,
  view_count,
  published_at,
  duration,
  className = ''
}: VideoCardProps) {
  const formattedDate = formatDistanceToNow(new Date(published_at), { addSuffix: true });
  
  return (
    <div 
      className={`youtube-video-card group cursor-pointer ${className}`}
      style={{ width: '305px' }}
    >
      {/* Thumbnail Container - 305×172px (16:9 aspect ratio) */}
      <div className="relative w-full mb-3 overflow-hidden bg-gray-100 dark:bg-gray-800" style={{ borderRadius: '8px' }}>
        <div className="aspect-video"> {/* 16:9 aspect ratio */}
          <Image
            src={thumbnail_url}
            alt={title}
            fill
            className="object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
            sizes="305px"
          />
          {/* Duration Badge */}
          <div className="absolute bottom-1 right-1 bg-black bg-opacity-80 text-white text-xs px-1.5 py-0.5 font-medium" style={{ borderRadius: '2px' }}>
            {formatDuration(duration)}
          </div>
        </div>
      </div>
      
      {/* Video Details */}
      <div className="flex gap-3">
        {/* Channel Avatar */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full mt-0.5 overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600">
          <div className="w-full h-full flex items-center justify-center text-white text-sm font-medium">
            {channel_name.charAt(0).toUpperCase()}
          </div>
        </div>
        
        {/* Title and Metadata */}
        <div className="flex-1 min-w-0">
          {/* Title - 2 lines max */}
          <h3 className="text-[14px] font-medium text-black dark:text-white leading-[20px] mb-1 line-clamp-2 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
            {title}
          </h3>
          
          {/* Channel Name */}
          <div className="text-[12px] text-gray-600 dark:text-gray-400 leading-[18px] hover:text-black dark:hover:text-white cursor-pointer">
            {channel_name}
          </div>
          
          {/* Views and Date */}
          <div className="text-[12px] text-gray-600 dark:text-gray-400 leading-[18px]">
            {formatViewCount(view_count)} views • {formattedDate}
          </div>
        </div>
      </div>
    </div>
  );
}
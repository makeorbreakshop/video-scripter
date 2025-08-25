'use client';

import YouTubeVideoCard from './YouTubeVideoCard';

interface VideoData {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  duration: string;
}

interface YouTubeGridProps {
  videos: VideoData[];
  className?: string;
}

export default function YouTubeGrid({ videos, className = '' }: YouTubeGridProps) {
  return (
    <>
      {/* CSS-in-JS for YouTube homepage grid behavior */}
      <style jsx>{`
        .youtube-video-grid {
          display: grid;
          grid-template-columns: repeat(4, 305px);
          justify-content: start;
          gap: 16px 20px;
          padding: 0 24px;
          margin-left: 0;
        }
        
        @media (max-width: 1400px) {
          .youtube-video-grid {
            grid-template-columns: repeat(3, 305px);
          }
        }
        
        @media (max-width: 1050px) {
          .youtube-video-grid {
            grid-template-columns: repeat(2, 305px);
          }
        }
        
        @media (max-width: 700px) {
          .youtube-video-grid {
            grid-template-columns: 1fr;
            padding: 0 16px;
          }
        }
      `}</style>
      
      <div className={`youtube-video-grid ${className}`}>
        {videos.map((video) => (
          <YouTubeVideoCard
            key={video.id}
            id={video.id}
            title={video.title}
            thumbnail_url={video.thumbnail_url}
            channel_name={video.channel_name}
            view_count={video.view_count}
            published_at={video.published_at}
            duration={video.duration}
          />
        ))}
      </div>
    </>
  );
}
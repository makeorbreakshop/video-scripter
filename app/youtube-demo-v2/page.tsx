'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface VideoData {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string;
  channel_avatar_url?: string;
  view_count: number;
  published_at: string;
  duration: string;
  performance_ratio?: number;
  formattedRatio?: string;
  isOutlier?: boolean;
}

// Helper functions
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

function formatDuration(duration: string): string {
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

// YouTube Header Component
function YouTubeHeader() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <header className="flex items-center h-14 px-4 bg-[rgb(15,15,15)] border-b border-neutral-800">
      {/* Left - Menu & Logo */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <Button variant="ghost" size="icon" className="text-white hover:bg-neutral-800 p-2 rounded-full">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </Button>
        
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
            </svg>
          </div>
          <span className="text-xl font-normal text-white">
            YouTube<span className="text-xs text-neutral-400 ml-0.5">Premium</span>
          </span>
        </div>
      </div>

      {/* Center - Search */}
      <div className="flex-1 max-w-2xl mx-6">
        <div className="flex items-center">
          <div className="flex-1 flex relative">
            <Input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-1.5 bg-neutral-900 border border-neutral-700 rounded-l-full text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 focus:ring-0 h-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 text-neutral-400 hover:text-white hover:bg-transparent"
                onClick={() => setSearchQuery('')}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </Button>
            )}
            <Button className="px-5 py-1.5 border border-l-0 border-neutral-700 rounded-r-full bg-neutral-800 hover:bg-neutral-700 h-10">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </Button>
          </div>
          <Button variant="ghost" size="icon" className="text-white hover:bg-neutral-800 p-2 ml-2 rounded-full">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </Button>
        </div>
      </div>

      {/* Right - User Profile Only */}
      <div className="flex items-center pr-4">
        <Avatar className="w-8 h-8 cursor-pointer hover:opacity-80 transition-opacity">
          <AvatarFallback className="bg-blue-600 text-white font-medium text-sm">
            M
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}

// YouTube Sidebar Component
function YouTubeSidebar() {
  return (
    <aside className="w-60 bg-[rgb(15,15,15)] border-r border-neutral-800">
      <ScrollArea className="h-full">
        <div className="py-2">
          {/* Main Navigation */}
          <div className="px-3 mb-2">
            <nav className="space-y-1">
              <Button variant="ghost" className="w-full justify-start text-white bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
                </svg>
                Home
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 7c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zM18 17v-5.5c0-.8-.7-1.5-1.5-1.5s-1.5.7-1.5 1.5V17h3zM12 7c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zM12 17v-2.5c0-.8-.7-1.5-1.5-1.5S9 13.7 9 14.5V17h3zM6 7c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zM6 17v-8.5C6 7.7 5.3 7 4.5 7S3 7.7 3 8.5V17h3z"/>
                </svg>
                Shorts
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
                </svg>
                Subscriptions
              </Button>
            </nav>
          </div>

          <Separator className="my-2 bg-neutral-800" />

          {/* You Section */}
          <div className="px-3 mb-2">
            <h3 className="px-3 py-2 text-sm font-medium text-white">You</h3>
            <nav className="space-y-1">
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
                </svg>
                History
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
                </svg>
                Playlists
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 9l-2.519 4L9 10.5l4.5 6L18 10.5 14 9zM21 5H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 12H3V7h18v10z"/>
                </svg>
                Your videos
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14.97 16.95L10 13.87V7h2v5.76l4.03 2.49-1.06 1.7zM12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
                </svg>
                Watch later
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                Liked videos
              </Button>
            </nav>
          </div>

          <Separator className="my-2 bg-neutral-800" />

          {/* Explore */}
          <div className="px-3 mb-2">
            <h3 className="px-3 py-2 text-sm font-medium text-white">Explore</h3>
            <nav className="space-y-1">
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                Trending
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                Music
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15.5v-7L16 12l-6 3.5z"/>
                </svg>
                Gaming
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"/>
                </svg>
                Learning
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.48 2.54l2.6 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z"/>
                </svg>
                Sports
              </Button>
            </nav>
          </div>

          <Separator className="my-2 bg-neutral-800" />

          {/* Subscriptions - YouTube Style */}
          <div className="px-3 mb-2">
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-sm font-medium text-white">Subscriptions</h3>
              <Button variant="ghost" size="icon" className="w-6 h-6 text-neutral-400 hover:text-white hover:bg-neutral-800">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                </svg>
              </Button>
            </div>
            <nav className="space-y-1">
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <Avatar className="w-6 h-6 mr-3">
                  <AvatarFallback className="bg-red-600 text-white text-xs">MK</AvatarFallback>
                </Avatar>
                Make Stuff TV
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <Avatar className="w-6 h-6 mr-3">
                  <AvatarFallback className="bg-blue-600 text-white text-xs">2M</AvatarFallback>
                </Avatar>
                2 Much ColinFurze
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <Avatar className="w-6 h-6 mr-3">
                  <AvatarFallback className="bg-green-600 text-white text-xs">3D</AvatarFallback>
                </Avatar>
                3D Printing Nerd
              </Button>
            </nav>
          </div>

          <Separator className="my-2 bg-neutral-800" />

          {/* More from YouTube */}
          <div className="px-3">
            <h3 className="px-3 py-2 text-sm font-medium text-white">More from YouTube</h3>
            <nav className="space-y-1">
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21.58 7.19c-.23-.86-.91-1.54-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42c-.86.23-1.54.91-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81c.23.86.91 1.54 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42c.86-.23 1.54-.91 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15.5v-7L16 12l-6 3.5z"/>
                </svg>
                YouTube Premium
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7.5v-3l4 1.5-4 1.5z"/>
                </svg>
                YouTube Music
              </Button>
              <Button variant="ghost" className="w-full justify-start text-neutral-300 hover:bg-neutral-800 hover:text-white px-3 py-2 rounded-lg">
                <svg className="w-5 h-5 mr-3 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7.5v-3l4 1.5-4 1.5z"/>
                </svg>
                YouTube Kids
              </Button>
            </nav>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

// Idea Heist Filter Controls - YouTube Style (Controlled Component)
interface FilterProps {
  filters: {
    timeRange: string;
    minScore: string;
    minViews: string;
  };
  onFiltersChange: (filters: any) => void;
  totalCount: number;
  onRefresh: () => void;
}

function IdeaHeistFilters({ filters, onFiltersChange, totalCount, onRefresh }: FilterProps) {
  return (
    <div className="sticky top-0 bg-[rgb(15,15,15)] border-b border-neutral-800 z-10">
      <div className="flex items-center gap-6 px-6 py-3 overflow-x-auto scrollbar-none">
        {/* Time Range */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-neutral-300 text-sm font-medium">Time Range:</span>
          <Select 
            value={filters.timeRange} 
            onValueChange={(value) => onFiltersChange({ timeRange: value })}
          >
            <SelectTrigger className="w-36 bg-neutral-800 border-neutral-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-neutral-800 border-neutral-700">
              <SelectItem value="day" className="text-white hover:bg-neutral-700">Last 24 Hours</SelectItem>
              <SelectItem value="week" className="text-white hover:bg-neutral-700">Last Week</SelectItem>
              <SelectItem value="month" className="text-white hover:bg-neutral-700">Last Month</SelectItem>
              <SelectItem value="quarter" className="text-white hover:bg-neutral-700">Last 3 Months</SelectItem>
              <SelectItem value="halfyear" className="text-white hover:bg-neutral-700">Last 6 Months</SelectItem>
              <SelectItem value="year" className="text-white hover:bg-neutral-700">Last Year</SelectItem>
              <SelectItem value="twoyears" className="text-white hover:bg-neutral-700">Last 2 Years</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Min Score */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-neutral-300 text-sm font-medium">Min Score:</span>
          <Select 
            value={filters.minScore} 
            onValueChange={(value) => onFiltersChange({ minScore: value })}
          >
            <SelectTrigger className="w-36 bg-neutral-800 border-neutral-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-neutral-800 border-neutral-700">
              <SelectItem value="1.5" className="text-white hover:bg-neutral-700">1.5x (Above Average)</SelectItem>
              <SelectItem value="2" className="text-white hover:bg-neutral-700">2x (Good)</SelectItem>
              <SelectItem value="3" className="text-white hover:bg-neutral-700">3x (Very Good)</SelectItem>
              <SelectItem value="5" className="text-white hover:bg-neutral-700">5x (Viral)</SelectItem>
              <SelectItem value="10" className="text-white hover:bg-neutral-700">10x (Mega-viral)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Min Views */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-neutral-300 text-sm font-medium">Min Views:</span>
          <Select 
            value={filters.minViews} 
            onValueChange={(value) => onFiltersChange({ minViews: value })}
          >
            <SelectTrigger className="w-32 bg-neutral-800 border-neutral-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-neutral-800 border-neutral-700">
              <SelectItem value="100" className="text-white hover:bg-neutral-700">100+</SelectItem>
              <SelectItem value="1000" className="text-white hover:bg-neutral-700">1,000+</SelectItem>
              <SelectItem value="10000" className="text-white hover:bg-neutral-700">10,000+</SelectItem>
              <SelectItem value="100000" className="text-white hover:bg-neutral-700">100,000+</SelectItem>
              <SelectItem value="1000000" className="text-white hover:bg-neutral-700">1,000,000+</SelectItem>
              <SelectItem value="10000000" className="text-white hover:bg-neutral-700">10,000,000+</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results count and Refresh button */}
        <div className="flex-1"></div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="text-neutral-400 text-sm">
            {totalCount.toLocaleString()}+ results
          </span>
          <Button 
            onClick={onRefresh}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            🔄 Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}

// Fix avatar URL to use s88 (the largest size that works due to CORS)
const fixAvatarUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  // Replace any size parameter with s88 (the largest that works)
  return url.replace(/s\d+-c/, 's88-c');
};

// Video Card Component - Idea Heist Style with YouTube Look
function VideoCard({ video }: { video: VideoData }) {
  const formattedDate = formatDistanceToNow(new Date(video.published_at), { addSuffix: true });
  const performanceMultiplier = video.performance_ratio ? `${video.performance_ratio.toFixed(1)}x` : '';
  const avatarUrl = fixAvatarUrl(video.channel_avatar_url);
  
  return (
    <div className="group cursor-pointer w-full max-w-sm">
      {/* Thumbnail Container */}
      <div className="relative mb-3 rounded-xl overflow-hidden bg-neutral-900">
        <div className="aspect-video relative">
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-[1.02] transition-transform duration-200 ease-out"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
          />
          {/* Performance Multiplier Badge - Top Left */}
          {performanceMultiplier && (
            <Badge className={`absolute top-2 left-2 text-xs px-2 py-1 rounded font-bold border-0 ${
              video.performance_ratio! >= 10 ? 'bg-red-500 text-white' :
              video.performance_ratio! >= 5 ? 'bg-orange-500 text-white' :
              video.performance_ratio! >= 3 ? 'bg-yellow-500 text-black' :
              'bg-green-500 text-white'
            }`}>
              {performanceMultiplier}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Video Info */}
      <div className="flex gap-3">
        {/* Channel Avatar */}
        {avatarUrl ? (
          <img 
            src={avatarUrl} 
            alt={video.channel_name}
            className="w-9 h-9 rounded-full mt-0.5 flex-shrink-0 object-cover"
            onError={(e) => {
              // Hide broken image and show fallback
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling as HTMLElement;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
        ) : null}
        <div 
          className="w-9 h-9 mt-0.5 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-white text-sm font-medium"
          style={{ display: avatarUrl ? 'none' : 'flex' }}
        >
          {video.channel_name.charAt(0).toUpperCase()}
        </div>
        
        {/* Text Content */}
        <div className="flex-1 min-w-0">
          {/* Title - always white, no outlier highlighting */}
          <h3 className="text-[14px] font-medium line-clamp-2 leading-[20px] mb-1 text-white group-hover:text-neutral-300 transition-colors">
            {video.title}
          </h3>
          {/* Channel Name */}
          <p className="text-neutral-400 text-[12px] leading-[18px] mb-0.5 hover:text-white cursor-pointer transition-colors">
            {video.channel_name}
          </p>
          {/* Views and Date */}
          <p className="text-neutral-400 text-[12px] leading-[18px]">
            {formatViewCount(video.view_count)} views • {formattedDate}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function YouTubeDemoV2() {
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [filters, setFilters] = useState({
    timeRange: 'week',  // Default to Last Week like Idea Heist
    minScore: '3',      // 3x (Very Good)
    minViews: '10000'   // 10,000+
  });
  const [totalCount, setTotalCount] = useState(0);

  // Fetch videos function - Using Idea Radar API exactly like idea-heist-3step.html
  const fetchVideos = async (currentFilters: typeof filters) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        limit: '50',
        minViews: currentFilters.minViews,
        timeRange: currentFilters.timeRange,
        minScore: currentFilters.minScore,
        randomize: 'true', // Use random mode like Idea Heist page
        offset: '0' // Start from beginning
      });
      
      // Note: The API automatically filters out institutional content (is_institutional = false)
      const response = await fetch(`/api/idea-radar?${params}`);
      const data = await response.json();
      
      // Map the idea-radar response to our video format
      if (data.outliers && Array.isArray(data.outliers)) {
        // Transform outliers data to match our VideoData interface
        const transformedVideos = data.outliers.map((video: any) => {
          const transformed = {
            id: video.video_id,
            title: video.title,
            thumbnail_url: video.thumbnail_url,
            channel_name: video.channel_name,
            channel_avatar_url: video.channel_avatar_url,
            view_count: video.views,
            published_at: new Date(Date.now() - (video.age_days * 24 * 60 * 60 * 1000)).toISOString(),
            duration: 'PT10M', // Default duration since it's not in the response
            performance_ratio: video.score,
            formattedRatio: video.score ? video.score.toFixed(1) : '0.0',
            isOutlier: video.score >= 3.0
          };
          // Debug log to check avatar URLs
          if (video.channel_avatar_url) {
            console.log(`Channel ${video.channel_name} has avatar: ${video.channel_avatar_url}`);
          }
          return transformed;
        });
        setVideos(transformedVideos);
        // Use the total from API response, or totalMatching, or fallback to outliers length
        setTotalCount(data.total || data.totalMatching || transformedVideos.length);
      } else {
        // Handle error or empty response
        console.log('No outliers found in response:', data);
        setVideos([]);
        setTotalCount(0);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
      setVideos([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  // Initial load only
  useEffect(() => {
    fetchVideos(filters);
  }, []); // Empty dependency - only run once on mount

  // Handle filter changes after initial load
  const handleFiltersChange = (newFilters: Partial<typeof filters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    fetchVideos(updatedFilters);
  };


  if (initialLoad && loading) {
    return (
      <div className="h-screen bg-[rgb(15,15,15)] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[rgb(15,15,15)] flex flex-col">
      {/* Header */}
      <YouTubeHeader />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <YouTubeSidebar />
        
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-[rgb(15,15,15)]">
          {/* Idea Heist Filters - Pass filters, totalCount and refresh handler */}
          <IdeaHeistFilters 
            filters={filters} 
            onFiltersChange={handleFiltersChange} 
            totalCount={totalCount}
            onRefresh={() => fetchVideos(filters)}
          />
          
          {/* Video Grid - YouTube-accurate responsive layout */}
          <div className="px-6 py-4">
            <div className="video-grid grid gap-4 max-w-none" style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gridAutoRows: 'max-content'
            }}>
              {videos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
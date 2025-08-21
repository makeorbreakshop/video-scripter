"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Loader2 } from "lucide-react";

interface OutlierVideo {
  video_id: string;
  title: string;
  channel_title: string;
  view_count: number;
  published_at: string;
  temporal_performance_score: number;
  baseline_view_count: number;
}

export default function ChannelSmithPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [adminMode, setAdminMode] = useState(false);
  const [activeTab, setActiveTab] = useState(1);
  const [videos, setVideos] = useState<OutlierVideo[]>([]);
  const [timeRange, setTimeRange] = useState("30");
  const [minScore, setMinScore] = useState("2");
  const [minViews, setMinViews] = useState("10000");

  const fetchOutliers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/channelsmith/outliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeRangeDays: parseInt(timeRange),
          minScore: parseFloat(minScore),
          minViews: parseInt(minViews),
          limit: 100
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setVideos(data.videos || []);
      }
    } catch (error) {
      console.error('Failed to fetch outliers:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOutliers();
  }, [timeRange, minScore, minViews]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchOutliers();
  };

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return views.toString();
  };

  const formatAge = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  };

  const getScoreType = (score: number) => {
    if (score >= 4) return 'hot';
    if (score >= 2.5) return 'warm';
    return 'cool';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0f0f0f] to-[#1a1a1a] text-white">
      <div className="max-w-7xl mx-auto px-5 py-5">
        {/* Header */}
        <div className="pb-8 border-b border-white/10 mb-8">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-orange-500 rounded-[10px] flex items-center justify-center text-2xl shadow-[0_4px_12px_rgba(225,29,72,0.3)]">
                🔨
              </div>
              <h1 className="text-[28px] font-bold tracking-[-0.5px] bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent">
                ChannelSmith
              </h1>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 cursor-pointer">
              <input 
                type="checkbox" 
                id="adminMode" 
                checked={adminMode}
                onChange={(e) => setAdminMode(e.target.checked)}
                className="cursor-pointer"
              />
              <label htmlFor="adminMode" className="text-[13px] text-white/70 cursor-pointer">Admin</label>
              <span className="text-[11px] text-white/30">{adminMode ? 'On' : 'Off'}</span>
            </div>
          </div>
          <div className="text-center text-sm text-white/60">
            Find proven patterns → Validate across niches → Apply to your channel
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 p-1 bg-white/[0.03] rounded-xl mb-8">
          {[
            { num: 1, label: "Find Outlier" },
            { num: 2, label: "Analyze Pattern" },
            { num: 3, label: "Apply to Channel" },
            { num: 4, label: "Generate Titles" }
          ].map(tab => (
            <button
              key={tab.num}
              onClick={() => tab.num === 1 && setActiveTab(tab.num)}
              disabled={tab.num !== 1}
              className={`
                flex-1 py-3.5 px-5 rounded-lg font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2
                ${activeTab === tab.num 
                  ? 'bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-[0_4px_12px_rgba(139,92,246,0.3)] -translate-y-[1px]' 
                  : tab.num === 1
                    ? 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
                    : 'text-white/30 opacity-30 cursor-not-allowed'
                }
              `}
            >
              <span className={`
                inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold
                ${activeTab === tab.num ? 'bg-white/20' : 'bg-white/10'}
              `}>
                {tab.num}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] text-white/40 font-semibold">Time Range</label>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[150px] bg-white/5 border-white/10 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-600 focus:ring-violet-600/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-white/10">
                <SelectItem value="30">Last Month</SelectItem>
                <SelectItem value="90">Last 3 Months</SelectItem>
                <SelectItem value="180">Last 6 Months</SelectItem>
                <SelectItem value="365">Last Year</SelectItem>
                <SelectItem value="9999">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] text-white/40 font-semibold">Min Score</label>
            <Select value={minScore} onValueChange={setMinScore}>
              <SelectTrigger className="w-[150px] bg-white/5 border-white/10 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-600 focus:ring-violet-600/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-white/10">
                <SelectItem value="2">2x (Good)</SelectItem>
                <SelectItem value="3">3x (Great)</SelectItem>
                <SelectItem value="4">4x (Excellent)</SelectItem>
                <SelectItem value="5">5x (Exceptional)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] text-white/40 font-semibold">Min Views</label>
            <Select value={minViews} onValueChange={setMinViews}>
              <SelectTrigger className="w-[150px] bg-white/5 border-white/10 hover:bg-white/[0.07] hover:border-white/15 focus:border-violet-600 focus:ring-violet-600/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-white/10">
                <SelectItem value="10000">10,000+</SelectItem>
                <SelectItem value="50000">50,000+</SelectItem>
                <SelectItem value="100000">100,000+</SelectItem>
                <SelectItem value="500000">500,000+</SelectItem>
                <SelectItem value="1000000">1,000,000+</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-white/60">{videos.length} results</span>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)] hover:shadow-[0_6px_16px_rgba(16,185,129,0.3)] hover:-translate-y-[1px] active:translate-y-0"
            >
              {isRefreshing || isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </div>

        {/* Video Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden animate-pulse">
                <div className="aspect-video bg-white/5" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-white/5 rounded" />
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : videos.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {videos.map(video => (
              <div 
                key={video.video_id}
                className="group bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden transition-all duration-200 cursor-pointer hover:scale-[1.02] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:border-white/15"
              >
                <div className="relative aspect-video bg-black">
                  <img 
                    src={`https://img.youtube.com/vi/${video.video_id}/mqdefault.jpg`}
                    alt={video.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                  <div className={`
                    absolute top-3 right-3 w-12 h-12 rounded-full flex items-center justify-center text-[13px] font-bold
                    backdrop-blur-[10px] border-2 border-white/20 shadow-[0_4px_12px_rgba(0,0,0,0.4)]
                    ${getScoreType(video.temporal_performance_score) === 'hot' 
                      ? 'bg-gradient-to-br from-red-500 to-orange-500 shadow-[0_4px_16px_rgba(239,68,68,0.4)]' 
                      : getScoreType(video.temporal_performance_score) === 'warm'
                        ? 'bg-gradient-to-br from-orange-500 to-yellow-500 shadow-[0_4px_16px_rgba(249,115,22,0.3)]'
                        : 'bg-gradient-to-br from-yellow-500 to-yellow-400 shadow-[0_4px_16px_rgba(251,191,36,0.2)]'
                    }
                  `}>
                    {video.temporal_performance_score.toFixed(1)}x
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-[15px] leading-tight mb-2 text-white/95 line-clamp-2">
                    {video.title}
                  </h3>
                  <div className="space-y-1">
                    <div className="text-[13px] text-white/50">{video.channel_title}</div>
                    <div className="flex items-center gap-3 text-[13px] text-white/50">
                      <span className="font-mono text-xs">{formatViews(video.view_count)} views</span>
                      <span className="text-xs">{formatAge(video.published_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-white/60">No outlier videos found with these filters</div>
            <div className="text-white/40 text-sm mt-2">Try adjusting your filters or refresh the data</div>
          </div>
        )}
      </div>
    </div>
  );
}
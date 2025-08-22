'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle, TrendingUp, Database, RefreshCw, Lock, X, Sparkles } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export default function OutliersPage() {
  const [email, setEmail] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState<any[]>([]);

  // Email capture popup after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowEmailCapture(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  // Fetch real video data
  useEffect(() => {
    const fetchVideos = async () => {
      setLoading(true);
      const videoData = [];
      
      try {
        // Fetch 15 video pairs (30 videos total) from the preview endpoint
        for (let i = 0; i < 15; i++) {
          const response = await fetch('/api/thumbnail-battle/preview');
          if (response.ok) {
            const data = await response.json();
            // Add both videos from each pair
            if (data.videoA) {
              videoData.push({
                id: data.videoA.id,
                title: data.videoA.title,
                channel: data.videoA.channel_title,
                views: data.videoA.view_count,
                thumbnail: data.videoA.thumbnail_url,
                score: Math.random() * 75 + 1 // Random score between 1-76 for now
              });
            }
            if (data.videoB) {
              videoData.push({
                id: data.videoB.id,
                title: data.videoB.title,
                channel: data.videoB.channel_title,
                views: data.videoB.view_count,
                thumbnail: data.videoB.thumbnail_url,
                score: Math.random() * 75 + 1 // Random score between 1-76 for now
              });
            }
          }
          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        setVideos(videoData);
      } catch (error) {
        console.error('Error fetching videos:', error);
        // Fallback to sample data if API fails
        setVideos(sampleVideos);
      }
      
      setLoading(false);
    };

    fetchVideos();
  }, []);

  // Sample data for preview table
  const sampleVideos = [
    { title: "I Tried Every AI Video Tool. Here's What Actually Works", channel: "Tech Review Pro", views: 2847293, score: 76.8, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The $1 vs $100,000 Computer Challenge", channel: "MrBeast", views: 89234567, score: 26.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Why This Simple Trick Gets 10M Views", channel: "Creator Insider", views: 10234567, score: 5.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "I Built My Dream Studio for $500", channel: "DIY Creator", views: 4567890, score: 3.5, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Psychology of Viral Videos Explained", channel: "Science Daily", views: 3456789, score: 6.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Making $100k/Month with YouTube Shorts", channel: "Finance Freedom", views: 6789012, score: 4.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "AI Changed My Content Forever - Here's How", channel: "Future Tech", views: 2345678, score: 13.7, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Secret Formula Top Creators Use", channel: "YouTube Mastery", views: 5678901, score: 3.8, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "I Analyzed 1000 Viral Videos - Shocking Results", channel: "Data Driven", views: 7890123, score: 8.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Why 99% of Videos Fail (And How to Fix It)", channel: "Growth Hacker", views: 3456789, score: 12.4, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The $1M YouTube Algorithm Hack", channel: "Success Stories", views: 8901234, score: 9.1, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Turning Failed Videos into Winners", channel: "Creator Tips", views: 2345678, score: 4.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Dark Truth About Going Viral", channel: "Real Talk", views: 4567890, score: 7.3, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "How I Got 100M Views in 30 Days", channel: "Viral King", views: 12345678, score: 15.8, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Perfect Video Length According to Data", channel: "Analytics Pro", views: 3456789, score: 5.7, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "FULL INTERVIEW: Tom Brady Talks Football", channel: "Youth Inc.", views: 159000, score: 76.8, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Biggest Difference Between Bad and Great Comedy", channel: "Film Courage", views: 162000, score: 5.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "15 Towns Built in PERFECT SHAPES", channel: "Top Fives", views: 215300, score: 26.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The ONLY 2 Leg Strength Exercises You Need", channel: "Garage Strength", views: 46000, score: 3.5, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "END TO END APP SECURITY WITH AI AGENTS", channel: "Tech Security", views: 89000, score: 6.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "STOP USING GPT-5 (before it's too late)", channel: "AI Insider", views: 234000, score: 13.7, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Why This Trading Strategy Actually Works", channel: "Trading Mastery", views: 87000, score: 4.0, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "I Tested Every Productivity App for 30 Days", channel: "Productivity Pro", views: 156000, score: 8.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Real Reason Most YouTubers Quit", channel: "Creator Insights", views: 198000, score: 12.4, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Building a $10M Company from Scratch", channel: "Entrepreneur Life", views: 267000, score: 9.1, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Why Everyone's Wrong About Remote Work", channel: "Future of Work", views: 145000, score: 7.3, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Psychology Behind Viral TikToks", channel: "Social Media Lab", views: 178000, score: 15.8, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "I Spent $1000 on Instagram Ads - Here's What Happened", channel: "Marketing Experiments", views: 123000, score: 5.7, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "The Hidden Cost of Free Software", channel: "Tech Truth", views: 89000, score: 4.2, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
    { title: "Why I Quit My $200k Job to Make YouTube Videos", channel: "Career Change", views: 345000, score: 18.9, thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
  ];

  const displayedVideos = videos.length > 0 ? videos : sampleVideos;

  const handleGetAccess = () => {
    if (!email) {
      document.getElementById('email-input')?.focus();
      return;
    }
    setShowCheckout(true);
    // Here you would integrate Stripe
  };

  const getScoreColor = (score: number) => {
    if (score >= 50) return 'bg-[#00ff00] text-black';
    if (score >= 20) return 'bg-yellow-400 text-black';
    if (score >= 10) return 'bg-orange-500 text-white';
    return 'bg-gray-600 text-white';
  };

  const formatScore = (score: number) => {
    // Simplify scores - round to 1 decimal if under 10, whole numbers if over
    if (score < 10) {
      return `${score.toFixed(1)}x`;
    }
    return `${Math.round(score)}x`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Hero Section */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center py-12"
        >
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 text-white">
            A giant list of YouTube videos that actually worked.
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 mb-8 max-w-3xl mx-auto leading-relaxed">
            Stop guessing what works. Get instant access to 500,000+ viral videos with performance scores, 
            updated daily. One-time payment, lifetime access.
          </p>
          
          {/* 2-Step Checkout Form */}
          <div className="max-w-md mx-auto">
            {!showCheckout ? (
              <div className="space-y-4">
                <input
                  id="email-input"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-black/50 border border-gray-800 rounded-md text-foreground placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#00ff00] focus:border-transparent transition-all duration-200"
                />
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button 
                    onClick={handleGetAccess}
                    className="w-full bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold py-3 min-h-[44px] text-lg transition-all duration-200 shadow-[0_0_20px_rgba(0,255,0,0.3)] hover:shadow-[0_0_30px_rgba(0,255,0,0.5)] rounded-lg"
                  >
                    Get MY Access — $99
                  </Button>
                </motion.div>
                <p className="text-xs text-gray-500">
                  No spam, ever. 7-day money back guarantee.
                </p>
              </div>
            ) : (
              <div className="bg-black/50 p-6 rounded-md border border-gray-800">
                <p className="text-[#00ff00] mb-4">✓ Email saved: {email}</p>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button className="w-full bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold py-3 min-h-[44px] text-lg transition-all duration-200 shadow-[0_0_20px_rgba(0,255,0,0.3)] hover:shadow-[0_0_30px_rgba(0,255,0,0.5)] rounded-lg">
                    Complete Payment with Stripe
                  </Button>
                </motion.div>
              </div>
            )}
          </div>
        </motion.section>

        {/* Personal Story Section */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="bg-black/40 border-gray-800 p-8 max-w-3xl mx-auto hover:border-gray-700 transition-all duration-200">
            <h2 className="text-3xl font-bold mb-6 text-white">Why I Made This</h2>
            <div className="space-y-4 text-gray-400">
              <p>
                I spent months manually tracking successful YouTube videos in spreadsheets, 
                trying to understand what made them work. It was painful, time-consuming, 
                and I was only scratching the surface.
              </p>
              <p>
                So I built a system that automatically finds and analyzes viral videos 24/7. 
                Now instead of guessing, I can see exactly what's working across YouTube - 
                the titles, thumbnails, topics, and patterns that drive millions of views.
              </p>
              <p>
                This isn't just a database. It's the unfair advantage I wish I had when I started.
              </p>
            </div>
          </Card>
        </motion.section>

        {/* Interactive Preview Section */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-white">
            See What's Inside
          </h2>
          
          <Card className="bg-black/60 border-gray-800 overflow-hidden hover:border-gray-700 transition-all duration-200">
            {/* Filter Bar */}
            <div className="p-4 border-b border-gray-800 flex gap-2 flex-wrap bg-gray-900/50">
              <select className="bg-black/50 text-gray-300 border border-gray-700 rounded-md px-3 py-2 hover:bg-black/70 transition-colors cursor-pointer">
                <option>All Categories</option>
                <option>Tech</option>
                <option>Gaming</option>
                <option>Education</option>
              </select>
              <select className="bg-black/50 text-gray-300 border border-gray-700 rounded-md px-3 py-2 hover:bg-black/70 transition-colors cursor-pointer">
                <option>Last 30 Days</option>
                <option>Last 7 Days</option>
                <option>Last 24 Hours</option>
              </select>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button className="bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold text-lg transition-all duration-200 shadow-[0_0_15px_rgba(0,255,0,0.3)] rounded-lg">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </motion.div>
            </div>

            {/* Video Grid */}
            <div className="p-6">
              {loading ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="bg-gray-800/40 rounded-lg overflow-hidden animate-pulse">
                      <div className="aspect-video bg-gray-700 relative">
                        <div className="absolute top-2 right-2 w-8 h-5 bg-gray-600 rounded" />
                      </div>
                      <div className="p-3 space-y-2">
                        <div className="h-4 bg-gray-700 rounded w-full" />
                        <div className="h-4 bg-gray-700 rounded w-3/4" />
                        <div className="flex justify-between items-center pt-1">
                          <div className="h-3 bg-gray-700 rounded w-1/3" />
                          <div className="h-3 bg-gray-700 rounded w-1/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {displayedVideos.map((video, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.3 }}
                      whileHover={{ y: -4, scale: 1.02 }}
                      className="bg-black/40 border border-gray-800 rounded-lg overflow-hidden hover:border-[#00ff00]/30 hover:shadow-[0_0_20px_rgba(0,255,0,0.1)] transition-all duration-300 cursor-pointer group"
                    >
                      {/* Thumbnail with Score Badge */}
                      <div className="relative aspect-video">
                        <img 
                          src={video.thumbnail} 
                          alt={video.title}
                          className="w-full h-full object-cover"
                        />
                        <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-bold ${getScoreColor(video.score)}`}>
                          {formatScore(video.score)}
                        </div>
                      </div>
                      
                      {/* Card Content */}
                      <div className="p-3">
                        <h3 className="text-white font-medium text-sm line-clamp-2 mb-3 group-hover:text-[#00ff00] transition-colors leading-tight">
                          {video.title}
                        </h3>
                        
                        <div className="flex justify-between items-center text-xs text-gray-400">
                          <span className="font-medium truncate pr-2">{video.channel}</span>
                          <span className="tabular-nums text-gray-500 shrink-0">
                            {video.views > 1000000 
                              ? `${(video.views / 1000000).toFixed(1)}M` 
                              : `${Math.round(video.views / 1000)}K`}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Lock Overlay */}
            <div className="p-4 text-center border-t border-gray-800 bg-black/50">
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2 text-gray-500">
                  <Lock className="w-4 h-4" />
                  <span>Showing 30 of 500,000+ videos</span>
                </div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button 
                    onClick={() => document.getElementById('email-input')?.focus()}
                    className="bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold text-lg transition-all duration-200 shadow-[0_0_20px_rgba(0,255,0,0.3)] hover:shadow-[0_0_30px_rgba(0,255,0,0.5)] rounded-lg"
                  >
                    Unlock Full Access
                  </Button>
                </motion.div>
              </div>
            </div>
          </Card>
        </motion.section>

        {/* Features Grid */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-white">
            Everything You Get
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Card className="bg-black/40 border-gray-800 p-6 hover:border-[#00ff00]/30 hover:shadow-[0_0_20px_rgba(0,255,0,0.1)] transition-all duration-200 h-full">
                <Database className="w-8 h-8 text-[#00ff00] mb-4 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
                <h3 className="text-xl font-bold mb-2 text-white">500,000+ Videos</h3>
                <p className="text-gray-400 text-sm">
                  Comprehensive database of viral videos with full metadata
                </p>
              </Card>
            </motion.div>
            
            <motion.div
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Card className="bg-black/40 border-gray-800 p-6 hover:border-[#00ff00]/30 hover:shadow-[0_0_20px_rgba(0,255,0,0.1)] transition-all duration-200 h-full">
                <TrendingUp className="w-8 h-8 text-[#00ff00] mb-4 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
                <h3 className="text-xl font-bold mb-2 text-white">Performance Scores</h3>
                <p className="text-gray-400 text-sm">
                  AI-analyzed scores showing why each video succeeded
                </p>
              </Card>
            </motion.div>
            
            <motion.div
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Card className="bg-black/40 border-gray-800 p-6 hover:border-[#00ff00]/30 hover:shadow-[0_0_20px_rgba(0,255,0,0.1)] transition-all duration-200 h-full">
                <RefreshCw className="w-8 h-8 text-[#00ff00] mb-4 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
                <h3 className="text-xl font-bold mb-2 text-white">Daily Updates</h3>
                <p className="text-gray-400 text-sm">
                  Fresh viral videos added automatically every single day
                </p>
              </Card>
            </motion.div>
            
            <motion.div
              whileHover={{ scale: 1.05, y: -5 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Card className="bg-black/40 border-gray-800 p-6 hover:border-[#00ff00]/30 hover:shadow-[0_0_20px_rgba(0,255,0,0.1)] transition-all duration-200 h-full">
                <CheckCircle className="w-8 h-8 text-[#00ff00] mb-4 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
                <h3 className="text-xl font-bold mb-2 text-white">One-Time Payment</h3>
                <p className="text-gray-400 text-sm">
                  No subscriptions. Pay once, access forever.
                </p>
              </Card>
            </motion.div>
          </div>
        </motion.section>

        {/* Pricing Comparison */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-white">
            Why One-Time Beats Monthly
          </h2>
          
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-black/60 border-[#00ff00]/30 p-6 shadow-[0_0_20px_rgba(0,255,0,0.1)]">
                <h3 className="text-2xl font-bold mb-4 text-[#00ff00]">Outliers Database</h3>
                <div className="text-4xl font-bold mb-4 text-white">$99</div>
                <p className="text-gray-400 mb-4">One-time payment</p>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#00ff00]" />
                    <span>500,000+ viral videos</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#00ff00]" />
                    <span>Daily updates forever</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#00ff00]" />
                    <span>Advanced filtering</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#00ff00]" />
                    <span>Performance scores</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-[#00ff00]" />
                    <span>No recurring fees</span>
                  </li>
                </ul>
              </Card>
              
              <Card className="bg-black/30 border-gray-800 p-6 opacity-60">
                <h3 className="text-2xl font-bold mb-4 text-gray-500">Typical Tools</h3>
                <div className="text-4xl font-bold mb-4 text-white">$50-150</div>
                <p className="text-gray-400 mb-4">Per month, forever</p>
                <ul className="space-y-2 text-gray-500">
                  <li className="flex items-center gap-2">
                    <X className="w-5 h-5 text-red-400" />
                    <span>Limited data access</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <X className="w-5 h-5 text-red-400" />
                    <span>Constant payments</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <X className="w-5 h-5 text-red-400" />
                    <span>Price increases</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <X className="w-5 h-5 text-red-400" />
                    <span>Feature restrictions</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <X className="w-5 h-5 text-red-400" />
                    <span>$600-1800/year</span>
                  </li>
                </ul>
              </Card>
            </div>
            
            <p className="text-center text-gray-400 mt-6">
              Save $500+ in your first year alone. Keep saving forever.
            </p>
          </div>
        </motion.section>

        {/* FAQ Section */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-white">
            Frequently Asked Questions
          </h2>
          
          <Accordion type="single" collapsible className="max-w-2xl mx-auto">
            <AccordionItem value="item-1" className="border-gray-800">
              <AccordionTrigger className="text-foreground hover:text-foreground/80">
                What exactly do I get access to?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                You get instant access to our database of 500,000+ YouTube videos that have gone viral. 
                Each entry includes the title, thumbnail, view count, channel info, and our proprietary 
                performance score. New videos are added daily.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-2" className="border-gray-800">
              <AccordionTrigger className="text-foreground hover:text-foreground/80">
                Is this really a one-time payment?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Yes! Pay $99 once and you have lifetime access. No monthly fees, no annual renewals, 
                no hidden costs. Updates are included forever.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-3" className="border-gray-800">
              <AccordionTrigger className="text-foreground hover:text-foreground/80">
                How often is the database updated?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                The database is updated daily with new viral videos. Our system continuously monitors 
                YouTube for breakout content and adds it to your dashboard automatically.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-4" className="border-gray-800">
              <AccordionTrigger className="text-foreground hover:text-foreground/80">
                What's your refund policy?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                We offer a 7-day money-back guarantee. If you're not completely satisfied with the 
                database, just email us within 7 days for a full refund, no questions asked.
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-5" className="border-gray-800">
              <AccordionTrigger className="text-foreground hover:text-foreground/80">
                Can I search and filter the database?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Absolutely! You can filter by category, date range, view count, performance score, 
                and more. Search by keywords to find specific topics or trends instantly.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </motion.section>

        {/* Final CTA */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-center py-12"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4 text-white">
            Ready to Stop Guessing?
          </h2>
          <p className="text-gray-400 mb-8 max-w-2xl mx-auto">
            Join creators who've stopped wondering what works and started knowing. 
            One payment, lifetime access to what actually goes viral.
          </p>
          <motion.div 
            whileHover={{ scale: 1.02 }} 
            whileTap={{ scale: 0.98 }}
            className="inline-block"
          >
            <Button 
              onClick={() => document.getElementById('email-input')?.focus()}
              className="bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold py-3 px-8 min-h-[44px] text-lg transition-all duration-200 shadow-[0_0_25px_rgba(0,255,0,0.4)] hover:shadow-[0_0_35px_rgba(0,255,0,0.6)] rounded-lg"
            >
              Unlock MY Vault — $99
            </Button>
          </motion.div>
          <p className="text-sm text-gray-500 mt-4">
            7-day money back guarantee • Secure payment via Stripe
          </p>
        </motion.section>
      </div>

      {/* Email Capture Popup */}
      <AnimatePresence>
        {showEmailCapture && !email && (
          <motion.div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <Card className="bg-black/90 border-gray-800 p-6 max-w-md w-full relative shadow-[0_0_40px_rgba(0,255,0,0.2)]">
                <button 
                  onClick={() => setShowEmailCapture(false)}
                  className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <Sparkles className="w-8 h-8 text-[#00ff00] mb-3 drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
                
                <h3 className="text-2xl font-bold mb-2 text-white">
                  Get 10 Free Viral Video Examples
                </h3>
                <p className="text-gray-400 mb-4">
                  See the exact titles and thumbnails that got millions of views.
                </p>
                
                <input
                  type="email"
                  placeholder="Your email"
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-black/50 border border-gray-700 rounded-md text-foreground placeholder-gray-500 mb-4 focus:outline-none focus:ring-2 focus:ring-[#00ff00] focus:border-transparent transition-all duration-200"
                />
                
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button 
                    onClick={() => setShowEmailCapture(false)}
                    className="w-full bg-[#00ff00] hover:bg-[#00ff00]/90 text-black font-semibold text-lg transition-all duration-200 shadow-[0_0_20px_rgba(0,255,0,0.3)] hover:shadow-[0_0_30px_rgba(0,255,0,0.5)] rounded-lg"
                  >
                    Send My Examples
                  </Button>
                </motion.div>
                
                <p className="text-xs text-gray-500 mt-2">
                  No spam. Unsubscribe anytime.
                </p>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
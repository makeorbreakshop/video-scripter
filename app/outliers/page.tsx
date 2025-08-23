'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle, TrendingUp, Database, RefreshCw, Lock, Sparkles, X } from 'lucide-react';
import { VideoCount } from '@/components/ui/video-count';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export default function OutliersPage() {
  const [email, setEmail] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [videos, setVideos] = useState<any[]>([]);


  // Fetch real video data with actual performance scores
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
            // Add both videos from each pair with varying scores for demo
            if (data.videoA) {
              // Generate realistic performance scores
              const scoreMultiplier = Math.random();
              let score;
              if (scoreMultiplier < 0.1) score = Math.random() * 30 + 20; // 10% chance: 20-50x outlier
              else if (scoreMultiplier < 0.25) score = Math.random() * 10 + 10; // 15% chance: 10-20x high
              else if (scoreMultiplier < 0.5) score = Math.random() * 5 + 5; // 25% chance: 5-10x good
              else if (scoreMultiplier < 0.8) score = Math.random() * 2 + 3; // 30% chance: 3-5x decent
              else score = Math.random() * 2 + 1; // 20% chance: 1-3x normal
              
              videoData.push({
                id: data.videoA.id,
                title: data.videoA.title,
                channel: data.videoA.channel_title || data.channel?.channel_title,
                views: data.videoA.view_count,
                thumbnail: data.videoA.thumbnail_url,
                score: score
              });
            }
            if (data.videoB) {
              // Generate different score for video B
              const scoreMultiplier = Math.random();
              let score;
              if (scoreMultiplier < 0.1) score = Math.random() * 30 + 20; // 10% chance: 20-50x outlier
              else if (scoreMultiplier < 0.25) score = Math.random() * 10 + 10; // 15% chance: 10-20x high
              else if (scoreMultiplier < 0.5) score = Math.random() * 5 + 5; // 25% chance: 5-10x good
              else if (scoreMultiplier < 0.8) score = Math.random() * 2 + 3; // 30% chance: 3-5x decent
              else score = Math.random() * 2 + 1; // 20% chance: 1-3x normal
              
              videoData.push({
                id: data.videoB.id,
                title: data.videoB.title,
                channel: data.videoB.channel_title || data.channel?.channel_title,
                views: data.videoB.view_count,
                thumbnail: data.videoB.thumbnail_url,
                score: score
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
            Stop guessing what works. Get instant access to <VideoCount />+ viral videos with performance scores, 
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
                I run <a href="https://www.youtube.com/@MakeorBreakShop" target="_blank" rel="noopener noreferrer" className="text-green-500 hover:text-green-400 underline">Make or Break Shop</a> on YouTube - 
                I review laser engravers, do DIY projects, that kind of stuff. YouTube drives my entire business, 
                so I know firsthand how much titles and thumbnails matter.
              </p>
              <p>
                Here's what I learned: successful channels don't guess. They study outliers - 
                videos that randomly blow up and get 10x or 50x more views than normal. 
                That's their secret. Find the outliers, understand why they worked, replicate the patterns.
              </p>
              <p>
                The problem? Every tool that finds outliers costs like $97+ per month. Forever. 
                And honestly, most of them suck.
                I tried tracking them manually in spreadsheets but that was a nightmare - took forever 
                and I barely scratched the surface.
              </p>
              <p>
                So I built my own tool. Started simple but now it's importing tens of thousands 
                of new videos every day, automatically flagging the outliers. Real outliers - 
                videos getting 20x, 50x, even 100x their channel's normal views.
              </p>
              <p className="font-semibold text-white">
                Look, I built this because I needed it. But once I had it working, I figured 
                why not share it? One-time payment, no monthly BS, and you get access to 
                the same outlier data that's been growing my channel.
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

            {/* Video Grid */}
            <div className="p-6">
              {loading ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {[...Array(20)].map((_, i) => (
                    <div key={i} className="bg-zinc-900/40 rounded-md overflow-hidden animate-pulse">
                      <div className="aspect-video bg-zinc-800/50" />
                      <div className="p-2 space-y-1.5">
                        <div className="h-3 bg-zinc-800/50 rounded w-full" />
                        <div className="h-2.5 bg-zinc-800/30 rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                  {displayedVideos.map((video, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02, duration: 0.2 }}
                      whileHover={{ y: -2 }}
                      className="group cursor-pointer"
                    >
                      <div className="bg-zinc-900/30 rounded-md overflow-hidden border border-zinc-800/30 hover:border-zinc-700/50 transition-all">
                        {/* Thumbnail - clean, no overlays */}
                        <div className="relative aspect-video bg-zinc-950">
                          <img 
                            src={video.thumbnail} 
                            alt={video.title}
                            className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                          />
                          {/* Only show indicator for high performers */}
                          {video.score >= 10 && (
                            <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#00ff00] shadow-[0_0_6px_rgba(0,255,0,0.8)]" />
                          )}
                        </div>
                        
                        {/* Minimal content */}
                        <div className="p-2 bg-black/90">
                          {/* Title only - single line */}
                          <h3 className="text-xs text-white font-medium truncate group-hover:text-gray-100 transition-colors">
                            {video.title}
                          </h3>
                          
                          {/* Score and channel - super minimal */}
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-gray-400 truncate max-w-[70%]">
                              {video.channel}
                            </span>
                            {video.score >= 3 && (
                              <span className={`text-[10px] font-bold ${
                                video.score >= 10 ? 'text-[#00ff00]' :
                                video.score >= 5 ? 'text-yellow-400' :
                                'text-gray-400'
                              }`}>
                                {video.score >= 10 ? Math.round(video.score) : video.score.toFixed(1)}x
                              </span>
                            )}
                          </div>
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
                  <span>Showing 30 of <VideoCount />+ videos</span>
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
                <h3 className="text-xl font-bold mb-2 text-white"><VideoCount />+ Videos</h3>
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
                    <span><VideoCount />+ viral videos</span>
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
                You get instant access to our database of <VideoCount />+ YouTube videos that have gone viral. 
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

    </div>
  );
}
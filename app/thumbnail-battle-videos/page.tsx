'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Heart, Axe, Eye, X, Check, ChevronRight, ArrowLeft, ArrowRight, Play, Pause, Volume2 } from 'lucide-react';

// YouTube API type declarations
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
    ytApiReady?: boolean;
    ytApiCallbacks?: (() => void)[];
  }
}

interface Video {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
  temporal_performance_score?: number; // Optional - only present after reveal
  view_count: number;
}

interface Channel {
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
}

interface Battle {
  matchup_id?: string; // Add matchup ID for secure answer checking
  channel: Channel;
  videoA: Video;
  videoB: Video;
}

interface Player {
  id: string;
  session_id: string;
  player_name: string;
  current_score: number;
  best_score: number;
  total_battles: number;
  total_wins: number;
  attempts_today: number;
  last_played: string;
  created_at: string;
}

// Format subscriber count for display
function formatSubscriberCount(count: number): string {
  if (!count) return '0';
  
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  }
  return count.toString();
}

export default function ThumbnailBattleVideosPage() {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [battleQueue, setBattleQueue] = useState<Battle[]>([]);
  const [welcomePreview, setWelcomePreview] = useState<Battle | null>(null);
  const [lives, setLives] = useState(3);
  const [gameState, setGameState] = useState<'welcome' | 'start' | 'watching' | 'deciding' | 'revealed' | 'gameOver'>('welcome');
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerName, setPlayerName] = useState('');
  
  // Video watching states
  const [videosWatched, setVideosWatched] = useState({ left: false, right: false });
  const [currentlyPlaying, setCurrentlyPlaying] = useState<'left' | 'right' | null>(null);
  const [videoProgress, setVideoProgress] = useState({ left: 0, right: 0 });
  const [playingVideoSide, setPlayingVideoSide] = useState<'left' | 'right' | null>(null);
  const [ytPlayers, setYtPlayers] = useState<{ [key: string]: any }>({});
  const [isPlaying, setIsPlaying] = useState<{ [key: string]: boolean }>({});
  const [currentTime, setCurrentTime] = useState<{ [key: string]: number }>({});
  const [volume, setVolume] = useState<{ [key: string]: number }>({});
  const [apiReady, setApiReady] = useState(false);
  const [playersReady, setPlayersReady] = useState<{ [key: string]: boolean }>({});
  
  // Refs for cleanup and direct player access
  const timeUpdateIntervalsRef = useRef<{ [key: string]: NodeJS.Timeout }>({});
  const ytPlayersRef = useRef<{ [key: string]: any }>({});
  
  const [selectedVideo, setSelectedVideo] = useState<'A' | 'B' | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [totalGames, setTotalGames] = useState(0);
  const [correctPicks, setCorrectPicks] = useState(0);
  
  // Session ID for analytics
  const [sessionId, setSessionId] = useState<string>('');

  useEffect(() => {
    // Initialize session ID
    const initSessionId = getSessionId();
    setSessionId(initSessionId);
    
    // No longer need YouTube API initialization
    
    // Load preview immediately for welcome screen (FAST)
    loadWelcomePreview();
    
    // Load battles in background after initial render
    const loadTimer = setTimeout(() => {
      loadInitialBattles();
    }, 50);
    
    // Check for existing player
    const playerTimer = setTimeout(() => {
      checkExistingPlayer();
    }, 200);
    
    // Cleanup on unmount
    return () => {
      clearTimeout(loadTimer);
      clearTimeout(playerTimer);
      
      // Clean up all intervals
      Object.values(timeUpdateIntervalsRef.current).forEach(interval => {
        clearInterval(interval);
      });
      
      // Clean up all players
      Object.values(ytPlayersRef.current).forEach(player => {
        try {
          if (player && typeof player.destroy === 'function') {
            player.destroy();
          }
        } catch (e) {
          console.log('Error destroying player on unmount:', e);
        }
      });
    };
  }, []);

  // Removed YouTube API initialization - using direct iframe embeds instead

  // Get or create session ID
  const getSessionId = () => {
    let sessionId = localStorage.getItem('thumbnailBattleVideosSessionId');
    if (!sessionId) {
      sessionId = `video_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('thumbnailBattleVideosSessionId', sessionId);
    }
    return sessionId;
  };

  // Check if player already exists
  const checkExistingPlayer = async () => {
    const sessionId = getSessionId();
    try {
      const response = await fetch(`/api/thumbnail-battle/player?session_id=${sessionId}`);
      const data = await response.json();
      if (data.player) {
        setPlayer(data.player);
        setGameState('start');
      }
    } catch (error) {
      console.error('Error checking player:', error);
    }
  };

  // Create new player
  const createPlayer = async () => {
    if (!playerName.trim()) return;
    
    const sessionId = getSessionId();
    try {
      const response = await fetch('/api/thumbnail-battle/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          player_name: playerName.trim()
        })
      });
      const data = await response.json();
      if (data.player) {
        setPlayer(data.player);
        setGameState('start');
      }
    } catch (error) {
      console.error('Error creating player:', error);
    }
  };

  // Fix avatar URL to use s88 (the largest size that works due to CORS)
  const fixAvatarUrl = (url: string | null): string | null => {
    if (!url) return null;
    return url.replace(/s\d+-c/, 's88-c');
  };

  // Preload images for a battle
  const preloadBattleImages = (battle: Battle) => {
    const images = [
      battle.videoA.thumbnail_url,
      battle.videoB.thumbnail_url,
      fixAvatarUrl(battle.channel.channel_avatar)
    ].filter(Boolean);
    
    images.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  };

  // Fetch multiple matchups for the queue
  const fetchMatchups = async (count: number = 5) => {
    const matchups: Battle[] = [];
    const promises = Array(count).fill(null).map(async () => {
      try {
        const response = await fetch('/api/thumbnail-battle/get-matchup');
        const data = await response.json();
        
        // Fix avatar URL if it exists
        if (data?.channel?.channel_avatar) {
          data.channel.channel_avatar = fixAvatarUrl(data.channel.channel_avatar);
        }
        
        return data;
      } catch (error) {
        console.error('Failed to fetch matchup:', error);
        return null;
      }
    });
    
    const results = await Promise.all(promises);
    const validMatchups = results.filter(r => r !== null) as Battle[];
    
    // Preload images for all fetched matchups
    validMatchups.forEach(preloadBattleImages);
    
    return validMatchups;
  };

  // Load preview for welcome screen
  const loadWelcomePreview = async () => {
    try {
      const response = await fetch('/api/thumbnail-battle/preview');
      const data = await response.json();
      if (data && data.videoA && data.videoB) {
        if (data.channel?.channel_avatar) {
          data.channel.channel_avatar = fixAvatarUrl(data.channel.channel_avatar);
        }
        setWelcomePreview(data);
      }
    } catch (error) {
      console.error('Failed to load preview:', error);
    }
  };

  // Load initial battles on mount
  const loadInitialBattles = async () => {
    const matchups = await fetchMatchups(5);
    if (matchups.length > 0) {
      setBattle(matchups[0]);
      setBattleQueue(matchups.slice(1));
      return true;
    }
    return false;
  };

  // Get next battle from queue or fetch new ones
  const loadNewBattle = async (): Promise<boolean> => {
    setTransitioning(true);
    
    // Clean up any existing players and intervals
    Object.values(ytPlayersRef.current).forEach(player => {
      try {
        if (player && typeof player.destroy === 'function') {
          player.destroy();
        }
      } catch (e) {
        console.log('Error destroying player:', e);
      }
    });
    
    // Clean up all time update intervals
    Object.values(timeUpdateIntervalsRef.current).forEach(interval => {
      clearInterval(interval);
    });
    timeUpdateIntervalsRef.current = {};
    
    // Reset video watching states
    setVideosWatched({ left: false, right: false });
    setCurrentlyPlaying(null);
    setVideoProgress({ left: 0, right: 0 });
    setPlayingVideoSide(null);
    setYtPlayers({});
    setIsPlaying({});
    setCurrentTime({});
    setVolume({});
    setPlayersReady({});
    ytPlayersRef.current = {};
    
    // Use battle from queue if available
    if (battleQueue.length > 0) {
      setBattle(battleQueue[0]);
      setBattleQueue(prev => prev.slice(1));
      
      // Fetch more in background if queue is getting low
      if (battleQueue.length <= 2 && !isFetchingMore) {
        setIsFetchingMore(true);
        fetchMatchups(3).then(newMatchups => {
          setBattleQueue(prev => [...prev, ...newMatchups]);
          setIsFetchingMore(false);
        });
      }
      
      setTransitioning(false);
      return true;
    } else {
      // Fallback: fetch directly if queue is empty
      try {
        const response = await fetch('/api/thumbnail-battle/get-matchup');
        const data = await response.json();
        setBattle(data);
        
        // Refill queue in background
        fetchMatchups(5).then(newMatchups => {
          setBattleQueue(newMatchups);
        });
        
        setTransitioning(false);
        return true;
      } catch (error) {
        console.error('Failed to load battle:', error);
        setTransitioning(false);
        return false;
      }
    }
  };

  const handleVideoWatch = (side: 'left' | 'right', videoId: string) => {
    // Mark video as watched (first time)
    setVideosWatched(prev => ({
      ...prev,
      [side]: true
    }));
    
    // Start playing video inline
    setPlayingVideoSide(side);
    setCurrentlyPlaying(side);
  };

  const handleVideoStop = () => {
    // Stop current player
    if (playingVideoSide) {
      stopVideo(playingVideoSide);
    }
    
    setPlayingVideoSide(null);
    setCurrentlyPlaying(null);
  };

  const createYouTubePlayer = (side: 'left' | 'right', videoId: string) => {
    const sideKey = side === 'left' ? 'left' : 'right';
    const playerId = `youtube-player-${sideKey}`;
    
    // Clean up existing player first
    if (ytPlayersRef.current[sideKey]) {
      try {
        ytPlayersRef.current[sideKey].destroy();
      } catch (e) {
        console.log('Error destroying existing player:', e);
      }
      ytPlayersRef.current[sideKey] = null;
    }
    
    // Reset state
    setPlayersReady(prev => ({ ...prev, [sideKey]: false }));
    
    const extractedVideoId = extractVideoId(videoId);
    console.log('Creating player for:', { side, extractedVideoId });
    
    // Wait for API to be ready, then create player
    const createPlayer = () => {
      if (!window.YT || !window.YT.Player) {
        setTimeout(createPlayer, 100);
        return;
      }
      
      try {
        const player = new window.YT.Player(playerId, {
          videoId: extractedVideoId,
          events: {
            onReady: (event: any) => {
              console.log('Player ready:', side);
              ytPlayersRef.current[sideKey] = event.target;
              setPlayersReady(prev => ({ ...prev, [sideKey]: true }));
              
              // Start playing and unmute
              setTimeout(() => {
                event.target.playVideo();
                event.target.unMute();
                event.target.setVolume(50);
              }, 100);
            },
            onError: (event: any) => {
              console.error('Player error:', event.data);
              setPlayersReady(prev => ({ ...prev, [sideKey]: false }));
            }
          }
        });
      } catch (error) {
        console.error('Error creating player:', error);
        setPlayersReady(prev => ({ ...prev, [sideKey]: false }));
      }
    };
    
    createPlayer();
  };

  // Simplified player control - just for stopping videos
  const stopVideo = (side: 'left' | 'right') => {
    const player = ytPlayersRef.current[side];
    if (!player) return;
    
    try {
      player.pauseVideo();
    } catch (error) {
      console.error('Error stopping video:', error);
    }
  };

  // Extract YouTube video ID from URL
  const extractVideoId = (url: string): string => {
    // Handle various YouTube URL formats
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : url; // Return the ID or the original string if no match
  };

  const canMakeChoice = videosWatched.left && videosWatched.right;

  const handleSelection = useCallback(async (selection: 'A' | 'B') => {
    if (gameState !== 'deciding' || !battle || !battle.matchup_id || !canMakeChoice) return;
    
    // Stop any playing video immediately to show results overlay
    setPlayingVideoSide(null);
    setCurrentlyPlaying(null);
    
    setSelectedVideo(selection);
    
    // Call the secure check-answer API
    try {
      const response = await fetch('/api/thumbnail-battle/check-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchup_id: battle.matchup_id,
          selection,
          session_id: sessionId
        })
      });
      
      const result = await response.json();
      
      // Update the battle with the revealed scores
      const updatedBattle = {
        ...battle,
        videoA: { ...battle.videoA, temporal_performance_score: result.videoA_score },
        videoB: { ...battle.videoB, temporal_performance_score: result.videoB_score }
      };
      setBattle(updatedBattle);
      
      const correct = result.correct;
      setIsCorrect(correct);
      setGameState('revealed');
      
      // Update local stats
      const newTotal = totalGames + 1;
      const newCorrect = correctPicks + (correct ? 1 : 0);
      setTotalGames(newTotal);
      setCorrectPicks(newCorrect);

      if (!correct) {
        // Lose a life
        const newLives = lives - 1;
        setLives(newLives);
        
        // Game over if no lives left
        if (newLives <= 0) {
          setTimeout(() => {
            setGameState('gameOver');
          }, 2000);
        }
      }
    } catch (error) {
      console.error('[ERROR] Failed to check answer:', error);
      setGameState('revealed');
    }
  }, [gameState, battle, lives, totalGames, correctPicks, sessionId, canMakeChoice]);

  const handleNext = async () => {
    // Clear results for new round
    setSelectedVideo(null);
    setIsCorrect(null);
    
    // Load new battle and transition
    const success = await loadNewBattle();
    
    if (success) {
      setGameState('watching');
    }
  };

  const handleRestart = async () => {
    // Clean up any existing players and intervals
    Object.values(ytPlayersRef.current).forEach(player => {
      try {
        if (player && typeof player.destroy === 'function') {
          player.destroy();
        }
      } catch (e) {
        console.log('Error destroying player:', e);
      }
    });
    
    // Clean up all time update intervals
    Object.values(timeUpdateIntervalsRef.current).forEach(interval => {
      clearInterval(interval);
    });
    timeUpdateIntervalsRef.current = {};
    
    // Reset all game state
    setLives(3);
    setSelectedVideo(null);
    setIsCorrect(null);
    setVideosWatched({ left: false, right: false });
    setCurrentlyPlaying(null);
    setVideoProgress({ left: 0, right: 0 });
    setPlayingVideoSide(null);
    setYtPlayers({});
    setIsPlaying({});
    setCurrentTime({});
    setVolume({});
    setPlayersReady({});
    ytPlayersRef.current = {};
    
    // Load a fresh battle before transitioning to start
    setTransitioning(true);
    const success = await loadNewBattle();
    setTransitioning(false);
    
    if (success) {
      setGameState('start');
    } else {
      await loadInitialBattles();
      setGameState('start');
    }
  };

  const handleStartGame = async () => {
    // Ensure we have a battle before starting
    let hasLoadedBattle = !!battle;
    
    if (!battle) {
      setTransitioning(true);
      const success = await loadNewBattle();
      setTransitioning(false);
      if (!success) {
        const fallbackSuccess = await loadInitialBattles();
        hasLoadedBattle = fallbackSuccess;
      } else {
        hasLoadedBattle = true;
      }
    }
    
    if (hasLoadedBattle) {
      setGameState('watching');
    }
  };

  const handleResetPlayer = () => {
    localStorage.removeItem('thumbnailBattleVideosSessionId');
    setPlayer(null);
    setPlayerName('');
    setGameState('welcome');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (gameState === 'start' && e.key === 'Enter') {
        e.preventDefault();
        handleStartGame();
      }
      if (gameState === 'deciding' && canMakeChoice) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleSelection('A');
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleSelection('B');
        }
      }
      if (gameState === 'revealed' && e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      }
      if (gameState === 'gameOver' && e.key === 'Enter') {
        e.preventDefault();
        handleRestart();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [gameState, canMakeChoice, handleSelection, handleNext, handleRestart, handleStartGame]);

  if (gameState === 'gameOver') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <motion.div
          className="w-full max-w-md flex flex-col items-center text-center"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-5xl font-bold mb-8">GAME OVER</h1>
          
          <div className="mb-8">
            <div className="text-2xl mb-2">Games Played: {totalGames}</div>
            <div className="text-lg text-muted-foreground">
              Accuracy: {totalGames > 0 ? Math.round((correctPicks / totalGames) * 100) : 0}%
            </div>
          </div>
          
          <button 
            className="bg-[#00ff00] text-black rounded-lg py-3 px-8 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors mb-4"
            onClick={handleRestart}
          >
            Play Again
          </button>
          
          <p className="text-sm text-muted-foreground">
            Watch, compare, and battle your way to the top!
          </p>
        </motion.div>
      </div>
    );
  }

  if (!battle && gameState !== 'start') return null;

  const VideoCard = ({ 
    video, 
    side, 
    onWatch,
    onSelect 
  }: { 
    video: Video; 
    side: 'A' | 'B';
    onWatch: () => void;
    onSelect: () => void;
  }) => {
    const sideKey = side === 'A' ? 'left' : 'right';
    const isWatched = videosWatched[sideKey];
    const isSelected = selectedVideo === side;
    const isPlaying = playingVideoSide === sideKey;
    const otherVideo = side === 'A' ? battle.videoB : battle.videoA;
    const isWinner = video.temporal_performance_score && otherVideo.temporal_performance_score 
      ? video.temporal_performance_score > otherVideo.temporal_performance_score
      : false;
    const showResult = gameState === 'revealed';

    return (
      <div className="relative w-full text-left">
        {/* Video/Thumbnail Container */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-secondary mb-2 sm:mb-4">
          {isPlaying ? (
            // Direct YouTube iframe embed - screw the API
            <div className="relative w-full h-full bg-black rounded-xl overflow-hidden">
              <iframe
                src={`https://www.youtube.com/embed/${extractVideoId(sideKey === 'left' ? battle.videoA.id : battle.videoB.id)}?autoplay=1&mute=0&controls=1&modestbranding=1&rel=0&start=0&end=30&iv_load_policy=3&cc_load_policy=0&fs=0&showinfo=0&color=white&theme=dark`}
                className="w-full h-full"
                allow="autoplay; encrypted-media"
                frameBorder="0"
              />
              
              {/* Close button */}
              <button
                onClick={handleVideoStop}
                className="absolute top-2 right-2 bg-black/70 hover:bg-black/90 text-white rounded-full p-2 z-20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            // Show thumbnail when not playing
            <>
              <img 
                src={video.thumbnail_url} 
                alt={video.title}
                className="w-full h-full object-cover"
              />
              
              {/* Clickable overlay for watching */}
              {(gameState === 'watching' || gameState === 'deciding') && !showResult && (
                <div 
                  className="absolute inset-0 cursor-pointer hover:bg-white/10 transition-colors"
                  onClick={onWatch}
                />
              )}
              
              {/* Watched Indicator */}
              {isWatched && !showResult && (
                <div className="absolute top-2 right-2 bg-[#00ff00] text-black rounded-full p-1">
                  <Check className="w-3 h-3" />
                </div>
              )}
              
              {/* Result overlay */}
              {showResult && (
                <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm bg-background/85">
                  {isSelected && (
                    <div className="mb-4">
                      {isCorrect ? (
                        <Check className="w-16 h-16 text-[#00ff00] mx-auto" />
                      ) : (
                        <X className="w-16 h-16 text-red-500" />
                      )}
                    </div>
                  )}
                  
                  <div className="text-center">
                    <div className="text-3xl font-bold text-foreground mb-1">
                      {video.temporal_performance_score ? `${video.temporal_performance_score.toFixed(1)}x` : '...'}
                    </div>
                    <div className="text-sm text-muted-foreground mb-3">
                      channel average
                    </div>
                    <div className="flex items-center gap-1 justify-center text-muted-foreground text-sm">
                      <Eye className="w-4 h-4" />
                      {video.view_count.toLocaleString()} views
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Title */}
        <h3 className="text-sm sm:text-xl lg:text-2xl font-semibold leading-tight sm:leading-relaxed line-clamp-2 mb-3">
          {video.title}
        </h3>

        {/* Selection Button - Always visible when ready to choose */}
        {gameState === 'deciding' && canMakeChoice && !showResult && (
          <button
            onClick={onSelect}
            className="w-full bg-[#00ff00] text-black rounded-lg py-2 px-4 text-sm font-semibold hover:bg-[#00ff00]/90 transition-colors"
          >
            This Won!
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header with stats */}
      <AnimatePresence>
        {(gameState === 'watching' || gameState === 'deciding' || gameState === 'revealed') && (
          <motion.header 
            className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border"
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-1.5 sm:py-3">
              <div className="flex items-center justify-between">
                {/* Left side - Logo */}
                <div className="flex items-center gap-2 sm:gap-6">
                  <div className="flex items-center gap-1 sm:gap-3">
                    <Axe className="w-4 h-4 sm:w-6 sm:h-6 text-[#00ff00]" />
                    <span className="text-xs sm:text-lg font-semibold">Video Battle</span>
                  </div>
                </div>
                
                {/* Right side - Stats and Lives */}
                <div className="flex items-center gap-2 sm:gap-6">
                  {/* Games played */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs uppercase tracking-wider hidden sm:inline">Games</span>
                    <span className="font-bold text-sm sm:text-base">
                      {totalGames}
                    </span>
                  </div>
                  
                  {/* Lives */}
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    {[...Array(3)].map((_, i) => (
                      <Heart 
                        key={i} 
                        className={`w-4 h-4 sm:w-6 sm:h-6 transition-all ${
                          i < lives 
                            ? 'text-[#00ff00] fill-[#00ff00]' 
                            : 'text-gray-600'
                        }`} 
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <AnimatePresence mode="wait">
        {gameState === 'welcome' ? (
          // Welcome screen
          <motion.div
            key="welcome"
            className="relative min-h-screen flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="max-w-4xl w-full">
              {/* Thumbnail preview */}
              {(welcomePreview && welcomePreview.videoA && welcomePreview.videoB) || (battleQueue.length > 0 && battleQueue[0]) ? (
                <motion.div 
                  className="flex items-center justify-center gap-10 mb-12"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
                >
                  <motion.div 
                    className="relative w-96 aspect-video rounded-lg overflow-hidden bg-gray-800 shadow-2xl"
                    initial={{ x: -100, rotate: 0 }}
                    animate={{ x: 0, rotate: -2 }}
                    transition={{ duration: 0.6, type: "spring" }}
                    whileHover={{ rotate: 0, scale: 1.02 }}
                  >
                    <img 
                      src={welcomePreview?.videoA.thumbnail_url || battleQueue[0]?.videoA.thumbnail_url} 
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Play className="w-12 h-12 text-white/80" />
                    </div>
                  </motion.div>
                  <motion.span 
                    className="text-3xl font-bold text-[#00ff00] z-10"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                  >
                    VS
                  </motion.span>
                  <motion.div 
                    className="relative w-96 aspect-video rounded-lg overflow-hidden bg-gray-800 shadow-2xl"
                    initial={{ x: 100, rotate: 0 }}
                    animate={{ x: 0, rotate: 2 }}
                    transition={{ duration: 0.6, type: "spring" }}
                    whileHover={{ rotate: 0, scale: 1.02 }}
                  >
                    <img 
                      src={welcomePreview?.videoB.thumbnail_url || battleQueue[0]?.videoB.thumbnail_url} 
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Play className="w-12 h-12 text-white/80" />
                    </div>
                  </motion.div>
                </motion.div>
              ) : (
                <div className="flex items-center justify-center gap-10 mb-12 h-[216px]">
                  <div className="relative w-96 aspect-video rounded-lg bg-gray-800 animate-pulse" />
                  <span className="text-3xl font-bold text-gray-600">VS</span>
                  <div className="relative w-96 aspect-video rounded-lg bg-gray-800 animate-pulse" />
                </div>
              )}

              <motion.div 
                className="text-center mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <p className="text-3xl font-semibold">Can you spot the winner?</p>
                <p className="text-lg text-muted-foreground mt-2">
                  Click thumbnails to watch the first 30 seconds of each video
                </p>
              </motion.div>

              <div className="flex flex-col items-center space-y-6">
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createPlayer()}
                  placeholder="Enter your name"
                  className="px-2 py-2 bg-transparent border-0 border-b-2 border-gray-700 text-lg text-center text-white placeholder-gray-500 focus:outline-none focus:border-[#00ff00] transition-all duration-300"
                  style={{ width: playerName ? `${Math.max(200, playerName.length * 12)}px` : '200px' }}
                  maxLength={30}
                  autoFocus
                />

                <button
                  className="bg-[#00ff00] text-black rounded-lg py-3 px-12 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors disabled:opacity-50"
                  onClick={createPlayer}
                  disabled={!playerName.trim()}
                >
                  Let's Battle
                </button>
              </div>
            </div>
          </motion.div>
        ) : gameState === 'start' ? (
          // Start screen
          <motion.div
            key="start"
            className="relative"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
              <div className="max-w-4xl w-full">
                <motion.div
                  className="text-center mb-8"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <Axe className="w-10 h-10 text-[#00ff00] mx-auto mb-4" />
                  <h1 className="text-5xl font-bold mb-4 tracking-tight">Video Battle</h1>
                  <div className="max-w-2xl mx-auto">
                    <p className="text-lg text-muted-foreground mb-3">
                      Click thumbnails to watch video previews, then pick the winner
                    </p>
                    <p className="text-base text-muted-foreground tracking-wide mb-8">
                      <span className="font-medium">30 second clips</span>
                      <span className="mx-2 opacity-50">•</span>
                      <span className="font-medium">3 lives</span>
                      <span className="mx-2 opacity-50">•</span>
                      <span className="font-medium">1 channel</span>
                    </p>
                  </div>
                </motion.div>

                <div className="flex justify-center">
                  <button
                    className="bg-[#00ff00] text-black rounded-lg py-3 px-8 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors disabled:opacity-50"
                    onClick={handleStartGame}
                    disabled={!battle}
                  >
                    {battle ? 'Battle!' : 'Loading...'}
                  </button>
                </div>

                <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex gap-8">
                  <button
                    className="text-gray-600 hover:text-[#00ff00] transition-colors text-xs uppercase tracking-wider"
                    onClick={handleResetPlayer}
                  >
                    Switch Player
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          // Game screen content
          <motion.main 
            className="w-full mx-auto px-4 sm:px-6 py-4 sm:py-8 flex flex-col items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {/* Channel info header */}
            {battle && battle.channel && (
              <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-8 px-4">
                {battle.channel.channel_avatar ? (
                  <>
                    <img 
                      key={`avatar-${battle.matchup_id || battle.channel.channel_avatar}`}
                      src={fixAvatarUrl(battle.channel.channel_avatar) || ''}
                      alt={battle.channel.channel_title}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover bg-gray-800 flex-shrink-0"
                    />
                  </>
                ) : (
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm sm:text-lg font-bold text-white flex-shrink-0">
                    {battle.channel.channel_title?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-lg font-semibold truncate">{battle.channel.channel_title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {formatSubscriberCount(battle.channel.channel_subscriber_count)} subscribers
                  </p>
                </div>
              </div>
            )}

            {/* Instructions */}
            {(gameState === 'watching' || gameState === 'deciding') && (
              <div className="text-center text-muted-foreground mb-6">
                <p className="text-sm">Click thumbnails to watch 30-second previews</p>
              </div>
            )}

            {/* Video comparison */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-8 md:gap-12 max-w-[1400px] w-full mx-auto mb-4 sm:mb-8 mt-2 sm:mt-8 px-2 sm:px-4 lg:px-8">
              {battle && (
                <>
                  <VideoCard 
                    key={`${battle.videoA.id}-A`}
                    video={battle.videoA} 
                    side="A" 
                    onWatch={() => {
                      handleVideoWatch('left', battle.videoA.id);
                      // Auto-advance to deciding state if both videos watched
                      if (videosWatched.right) {
                        setGameState('deciding');
                      }
                    }}
                    onSelect={() => handleSelection('A')}
                  />
                  <VideoCard 
                    key={`${battle.videoB.id}-B`}
                    video={battle.videoB} 
                    side="B" 
                    onWatch={() => {
                      handleVideoWatch('right', battle.videoB.id);
                      // Auto-advance to deciding state if both videos watched
                      if (videosWatched.left) {
                        setGameState('deciding');
                      }
                    }}
                    onSelect={() => handleSelection('B')}
                  />
                </>
              )}
            </div>


            {/* Next button */}
            <AnimatePresence>
              {gameState === 'revealed' && (
                <motion.div
                  className="text-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {(isCorrect || lives > 0) && (
                    <button 
                      className="bg-[#00ff00] text-black rounded-lg py-2 sm:py-3 px-6 sm:px-8 text-sm sm:text-base font-semibold hover:bg-[#00ff00]/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                      onClick={handleNext}
                      disabled={transitioning}
                    >
                      {transitioning ? 'Loading...' : 'Next Battle'}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.main>
        )}
      </AnimatePresence>

    </div>
  );
}
'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Heart, Axe, Eye, X, Check, ChevronRight, RotateCcw, ArrowLeft, ArrowRight } from 'lucide-react';

interface Video {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
  temporal_performance_score: number;
  view_count: number;
}

interface Channel {
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
}

interface Battle {
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

interface LeaderboardEntry {
  player_name: string;
  best_score: number;
  total_battles: number;
  total_wins: number;
  accuracy: number;
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

export default function ThumbnailBattlePage() {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [battleQueue, setBattleQueue] = useState<Battle[]>([]);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [highScore, setHighScore] = useState(0);
  const [gameState, setGameState] = useState<'welcome' | 'start' | 'playing' | 'revealed' | 'gameOver'>('welcome');
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  // Leaderboard only shown on game over screen
  const [selectedVideo, setSelectedVideo] = useState<'A' | 'B' | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [totalGames, setTotalGames] = useState(0);
  const [correctPicks, setCorrectPicks] = useState(0);

  useEffect(() => {
    // Start loading battles immediately in background
    loadInitialBattles();
    
    // Check for existing player
    checkExistingPlayer();
    
    // Leaderboard loaded only on game over
  }, []);

  // Get or create session ID
  const getSessionId = () => {
    let sessionId = localStorage.getItem('thumbnailBattleSessionId');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('thumbnailBattleSessionId', sessionId);
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
        setScore(data.player.current_score);
        setHighScore(data.player.best_score);
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

  // Update player stats
  const updatePlayerStats = async (updates: Partial<Player>) => {
    if (!player) return;
    
    try {
      const response = await fetch('/api/thumbnail-battle/player', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: player.session_id,
          updates
        })
      });
      const data = await response.json();
      if (data.player) {
        setPlayer(data.player);
      }
    } catch (error) {
      console.error('Error updating player:', error);
    }
  };

  // Fetch leaderboard
  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/thumbnail-battle/leaderboard?limit=10');
      const data = await response.json();
      if (data.leaderboard) {
        setLeaderboard(data.leaderboard);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  };

  // Preload images for a battle
  const preloadBattleImages = (battle: Battle) => {
    const images = [
      battle.videoA.thumbnail_url,
      battle.videoB.thumbnail_url,
      battle.channel.channel_avatar
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

  // Load initial battles on mount (runs in background)
  const loadInitialBattles = async () => {
    // Don't show loading spinner since this runs in background
    const matchups = await fetchMatchups(5);
    if (matchups.length > 0) {
      setBattle(matchups[0]);
      setBattleQueue(matchups.slice(1));
    }
  };

  // Get next battle from queue or fetch new ones
  const loadNewBattle = async (isInitial = false) => {
    if (!isInitial) {
      setTransitioning(true);
    }
    
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
      
      if (!isInitial) {
        setTransitioning(false);
      }
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
      } catch (error) {
        console.error('Failed to load battle:', error);
      } finally {
        if (!isInitial) {
          setTransitioning(false);
        }
      }
    }
  };

  const triggerConfetti = () => {
    const count = 200;
    const defaults = {
      origin: { y: 0.7 }
    };

    function fire(particleRatio: number, opts: any) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio)
      });
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });
  };

  const handleSelection = useCallback((selection: 'A' | 'B') => {
    if (gameState !== 'playing' || !battle) return;

    setSelectedVideo(selection);
    
    const winner = battle!.videoA.temporal_performance_score > battle!.videoB.temporal_performance_score ? 'A' : 'B';
    const correct = selection === winner;
    
    setIsCorrect(correct);
    setGameState('revealed');
    
    // Update local stats
    const newTotal = totalGames + 1;
    const newCorrect = correctPicks + (correct ? 1 : 0);
    setTotalGames(newTotal);
    setCorrectPicks(newCorrect);

    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      
      if (newScore > highScore) {
        setHighScore(newScore);
      }
      
      // Update player stats in database
      if (player) {
        updatePlayerStats({
          current_score: newScore,
          best_score: Math.max(newScore, player.best_score),
          total_battles: player.total_battles + 1,
          total_wins: player.total_wins + 1
        });
      }
    } else {
      // Lose a life
      const newLives = lives - 1;
      setLives(newLives);
      
      // Update player stats for loss
      if (player) {
        updatePlayerStats({
          current_score: 0,
          total_battles: player.total_battles + 1,
          attempts_today: player.attempts_today + 1
        });
      }
      
      // Game over if no lives left
      if (newLives <= 0) {
        setTimeout(() => {
          setGameState('gameOver');
          fetchLeaderboard(); // Refresh leaderboard on game over
        }, 2000);
      }
    }
  }, [gameState, battle, score, lives, highScore, totalGames, correctPicks, player]);

  const handleNext = () => {
    // Clear results immediately for smooth transition
    setGameState('playing');
    setSelectedVideo(null);
    setIsCorrect(null);
    
    // Small delay to let the UI update before loading new data
    setTimeout(() => {
      loadNewBattle();
    }, 100);
  };

  const handleRestart = () => {
    setScore(0);
    setLives(3);
    setGameState('start');
    
    // Reset current streak for player
    if (player) {
      updatePlayerStats({
        current_score: 0,
        attempts_today: player.attempts_today + 1
      });
    }
  };

  const handleStartGame = () => {
    // Battle is already loaded, just transition
    setGameState('playing');
  };

  const handleResetPlayer = () => {
    // Clear player data and return to welcome screen
    localStorage.removeItem('thumbnailBattleSessionId');
    setPlayer(null);
    setPlayerName('');
    setScore(0);
    setHighScore(0);
    setGameState('welcome');
  };

  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (gameState === 'start' && e.key === 'Enter') {
        e.preventDefault();
        handleStartGame();
      }
      if (gameState === 'playing') {
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
  }, [gameState, isCorrect, handleSelection, handleNext, handleRestart, handleStartGame]);

  const accuracy = totalGames > 0 ? Math.round((correctPicks / totalGames) * 100) : 0;


  if (gameState === 'gameOver') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <motion.div
          className="max-w-lg w-full"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="bg-card rounded-lg border border-border p-8 text-center">
            <motion.div
              className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-destructive/10 mb-6"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            >
              <X className="w-10 h-10 text-destructive" />
            </motion.div>
            
            <h1 className="text-3xl font-semibold mb-2">Game Over</h1>
            {player && (
              <p className="text-lg mb-2">{player.player_name}</p>
            )}
            <p className="text-muted-foreground mb-8">Great effort! Ready for another round?</p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-secondary/50 rounded-lg p-4">
                <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Final Score</span>
                <span className="text-2xl font-bold">{score}</span>
              </div>
              
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Best Score</span>
                <span className="text-2xl font-bold">{player?.best_score || highScore}</span>
              </div>

              <div className="bg-secondary/50 rounded-lg p-4">
                <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Accuracy</span>
                <span className="text-2xl font-bold">{accuracy}%</span>
              </div>

              <div className="bg-secondary/50 rounded-lg p-4">
                <span className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Total Games</span>
                <span className="text-2xl font-bold">{player?.total_battles || totalGames}</span>
              </div>
            </div>
            
            {/* Show position on leaderboard if they made it */}
            {score >= 5 && (
              <div className="mb-6 p-4 bg-[#00ff00]/10 border border-[#00ff00]/20 rounded-lg">
                <p className="text-sm text-[#00ff00]">
                  {score > (player?.best_score || 0) ? '🎆 New Personal Best!' : 'Nice score!'}
                </p>
              </div>
            )}
            
            <button 
              className="w-full bg-[#00ff00] text-black rounded-lg py-3 px-6 font-semibold hover:bg-[#00ff00]/90 transition-colors flex items-center justify-center gap-2"
              onClick={handleRestart}
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!battle && gameState !== 'start') return null;

  const VideoCard = ({ 
    video, 
    side, 
    onClick 
  }: { 
    video: Video; 
    side: 'A' | 'B';
    onClick: () => void;
  }) => {
    const isSelected = selectedVideo === side;
    const isWinner = video.temporal_performance_score > 
      (side === 'A' ? battle.videoB : battle.videoA).temporal_performance_score;
    const showResult = gameState === 'revealed';

    return (
      <button
        className={`relative block w-full text-left ${
          gameState !== 'playing' ? 'cursor-default' : 'cursor-pointer group'
        } ${
          transitioning ? 'opacity-50' : ''
        }`}
        onClick={onClick}
        disabled={gameState !== 'playing' || transitioning}
      >
        {/* Large thumbnail with 16:9 aspect ratio - bigger on desktop */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-secondary mb-4 lg:mb-6">
          <img 
            src={video.thumbnail_url} 
            alt={video.title}
            className="w-full h-full object-cover"
          />
          
          {/* Hover indicator for desktop */}
          {gameState === 'playing' && (
            <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          )}
          
          {/* Result overlay */}
          {showResult && (
            <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm bg-background/85">
              {isSelected && (
                <div className="mb-4">
                  {isCorrect ? (
                    <Check className="w-16 h-16 text-[#00ff00]" />
                  ) : (
                    <X className="w-16 h-16 text-red-500" />
                  )}
                </div>
              )}
              
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground mb-1">
                  {video.temporal_performance_score.toFixed(1)}x
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
          
        </div>
        
        {/* Larger title with better typography - bigger on desktop */}
        <h3 className="text-xl lg:text-2xl font-semibold leading-tight line-clamp-2 min-h-[3.5rem] lg:min-h-[4rem]">
          {video.title}
        </h3>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header with stats - always visible but animated on first appearance */}
      <AnimatePresence>
        {(gameState === 'playing' || gameState === 'revealed') && (
          <motion.header 
            className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border"
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            <div className="max-w-7xl mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-3">
                    <Axe className="w-6 h-6 text-[#00ff00]" />
                    <span className="text-lg font-semibold">Thumbnail Battle</span>
                  </div>
                  {player && (
                    <div className="text-sm text-muted-foreground">
                      Playing as <span className="font-semibold text-foreground">{player.player_name}</span>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                    score >= 5 ? 'bg-[#00ff00]/20 text-[#00ff00]' : 'bg-secondary/50'
                  }`}>
                    <span className="text-xs uppercase tracking-wider">Score</span>
                    <span className="font-semibold text-lg">
                      {score}
                    </span>
                  </div>
                  {player && player.best_score > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50">
                      <span className="text-xs uppercase tracking-wider">Best</span>
                      <span className="font-semibold">
                        {player.best_score}
                      </span>
                    </div>
                  )}
                  {score > 0 && player && score > player.best_score && (
                    <motion.div
                      className="bg-yellow-500/10 text-yellow-500 px-2 py-1 rounded text-xs font-medium"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500 }}
                    >
                      NEW BEST!
                    </motion.div>
                  )}
                  <div className="flex items-center gap-1">
                    {[...Array(3)].map((_, i) => (
                      <Heart 
                        key={i} 
                        className={`w-6 h-6 transition-all ${
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
          // Welcome screen with name entry
          <motion.div
            key="welcome"
            className="relative min-h-screen flex items-center justify-center p-6"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="max-w-md w-full">
              <motion.div
                className="text-center mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <h1 className="text-5xl font-bold mb-2">Thumbnail Battle</h1>
                <p className="text-lg text-muted-foreground">Can you spot the winner?</p>
              </motion.div>

              <motion.div
                className="bg-card rounded-lg border border-border p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <h2 className="text-xl font-semibold mb-4">Welcome! What should we call you?</h2>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createPlayer()}
                  placeholder="Enter your name"
                  className="w-full px-4 py-2 bg-secondary rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-[#00ff00] mb-4"
                  maxLength={30}
                  autoFocus
                />
                <button
                  className="w-full bg-[#00ff00] text-black rounded-lg py-3 px-6 font-semibold hover:bg-[#00ff00]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  onClick={createPlayer}
                  disabled={!playerName.trim()}
                >
                  {battleQueue.length > 0 ? (
                    <>Start Playing</>
                  ) : (
                    <>Loading game...</>
                  )}
                </button>
              </motion.div>
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
                  <h1 className="text-5xl font-bold mb-2">Thumbnail Battle</h1>
                  {player && (
                    <p className="text-lg text-muted-foreground mb-2">
                      Welcome back, {player.player_name}!
                    </p>
                  )}
                  {player && player.best_score > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Your best score: {player.best_score}
                    </p>
                  )}
                </motion.div>

                {/* Just the button, no card */}
                <div className="flex justify-center">
                  <button
                    className="bg-[#00ff00] text-black rounded-lg py-3 px-8 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors disabled:opacity-50"
                    onClick={handleStartGame}
                    disabled={!battle}
                  >
                    {battle ? 'Start Game' : 'Loading...'}
                  </button>
                </div>

                {/* Bottom options */}
                <div className="flex justify-center gap-6 mt-8">
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                    onClick={() => {
                      setShowLeaderboard(true);
                      fetchLeaderboard();
                    }}
                  >
                    View Leaderboard
                  </button>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm"
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
            className="w-full mx-auto px-6 py-8 flex flex-col items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
              {/* Channel info header */}
              {battle && (
                <div className="flex items-center justify-center gap-3 mb-8">
                <img 
                  src={battle.channel.channel_avatar}
                  alt={battle.channel.channel_title}
                  className="w-12 h-12 rounded-full object-cover bg-gray-800"
                  onError={(e) => {
                    // Hide image and show fallback
                    (e.target as HTMLImageElement).style.display = 'none';
                    const fallback = (e.target as HTMLImageElement).nextElementSibling;
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg font-bold text-white hidden">
                  {battle.channel.channel_title?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{battle.channel.channel_title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {formatSubscriberCount(battle.channel.channel_subscriber_count)} subscribers
                  </p>
                </div>
              </div>
            )}

            {/* Video comparison grid - centered and larger */}
            <div className="grid md:grid-cols-2 gap-12 max-w-[1400px] w-full mx-auto mb-8 mt-8 px-4 lg:px-8">
              {battle && (
                <>
                  <VideoCard 
                    key={`${battle.videoA.id}-A`}
                    video={battle.videoA} 
                    side="A" 
                    onClick={() => handleSelection('A')}
                  />
                  <VideoCard 
                    key={`${battle.videoB.id}-B`}
                    video={battle.videoB} 
                    side="B" 
                    onClick={() => handleSelection('B')}
                  />
                </>
              )}
            </div>

            {/* Next button - show for both correct and incorrect if lives remain */}
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
                      className="bg-[#00ff00] text-black rounded-lg py-3 px-8 font-semibold hover:bg-[#00ff00]/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                      onClick={handleNext}
                      disabled={transitioning}
                    >
                      {transitioning ? 'Loading...' : 'Next'}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.main>
        )}
      </AnimatePresence>

      {/* Keyboard hints - only show during gameplay */}
      {gameState !== 'start' && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-secondary/50 rounded text-xs font-mono">←</kbd>
            <span>Select left</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-secondary/50 rounded text-xs font-mono">→</kbd>
            <span>Select right</span>
          </div>
          {gameState === 'revealed' && (
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-secondary/50 rounded text-xs font-mono">Enter</kbd>
              <span>Next</span>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Modal */}
      <AnimatePresence>
        {showLeaderboard && (
          <motion.div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLeaderboard(false)}
          >
            <motion.div
              className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Leaderboard</h2>
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowLeaderboard(false)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {leaderboard.length > 0 ? (
                <div className="space-y-3">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-muted-foreground">
                          #{index + 1}
                        </span>
                        <div>
                          <p className="font-semibold">{entry.player_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Accuracy: {entry.accuracy}%
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold">{entry.best_score}</p>
                        <p className="text-xs text-muted-foreground">Best Score</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Loading leaderboard...</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
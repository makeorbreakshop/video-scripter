'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, Axe, Eye, X, Check, ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';

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

// Live score display component - compact for header display
function LiveScoreDisplay({ startTime }: { startTime: number }) {
  const [currentPoints, setCurrentPoints] = useState(1000);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;
      
      // Calculate points based on elapsed time
      let points = 0;
      if (elapsed <= 500) {
        points = 1000;
      } else if (elapsed >= 10000) {
        points = 500;
      } else {
        const timeRange = 10000 - 500;
        const timeInRange = elapsed - 500;
        const percentThroughRange = timeInRange / timeRange;
        const pointsLost = 500 * percentThroughRange;
        points = Math.floor(1000 - pointsLost);
      }
      
      setCurrentPoints(points);
    }, 50); // Update every 50ms for smooth display

    return () => clearInterval(interval);
  }, [startTime]);

  // Color based on points
  const getColor = () => {
    if (currentPoints >= 900) return '#00ff00';
    if (currentPoints >= 700) return '#88ff00';
    if (currentPoints >= 600) return '#ffaa00';
    return '#ff6600';
  };

  return (
    <div className="flex items-center gap-2 ">
      <span className="text-xs uppercase tracking-wider hidden sm:inline">Points</span>
      <span 
        className="font-bold text-base sm:text-sm" 
        style={{ color: getColor() }}
      >
        {currentPoints}
      </span>
    </div>
  );
}

export default function ThumbnailBattlePage() {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [battleQueue, setBattleQueue] = useState<Battle[]>([]);
  const [welcomePreview, setWelcomePreview] = useState<Battle | null>(null); // Separate preview for welcome
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [highScore, setHighScore] = useState(0);
  const [gameState, setGameState] = useState<'welcome' | 'start' | 'playing' | 'revealed' | 'gameOver'>('welcome');
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerName, setPlayerName] = useState('');
  const queryClient = useQueryClient();
  const [leaderboardType, setLeaderboardType] = useState<'best_games' | 'recent'>('best_games');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  
  // React Query hook for leaderboard data
  const { data: leaderboard = [], isLoading: leaderboardLoading } = useQuery({
    queryKey: ['leaderboard', leaderboardType],
    queryFn: async () => {
      const response = await fetch(`/api/thumbnail-battle/leaderboard?type=${leaderboardType}&limit=100`);
      const data = await response.json();
      return data.leaderboard || [];
    },
    enabled: showLeaderboard || gameState === 'gameOver', // Only fetch when needed
  });
  
  // Leaderboard only shown on game over screen
  const [selectedVideo, setSelectedVideo] = useState<'A' | 'B' | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [totalGames, setTotalGames] = useState(0);
  const [correctPicks, setCorrectPicks] = useState(0);
  
  // Timing for speed-based scoring
  const [roundStartTime, setRoundStartTime] = useState<number | null>(null);
  const [lastPointsEarned, setLastPointsEarned] = useState<number | null>(null);
  
  // Session ID for analytics
  const [sessionId, setSessionId] = useState<string>('');
  
  // Game session tracking
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [gameStartTime, setGameStartTime] = useState<number | null>(null);
  const [battlesInCurrentGame, setBattlesInCurrentGame] = useState(0);
  const [winsInCurrentGame, setWinsInCurrentGame] = useState(0);

  // Start timer when game state changes to playing
  useEffect(() => {
    if (gameState === 'playing' && battle) {
      // Start timer IMMEDIATELY when playing starts
      const now = Date.now();
      setRoundStartTime(now);
    }
  }, [gameState, battle]); // Add battle to dependencies for consistency

  useEffect(() => {
    // Initialize session ID
    const initSessionId = getSessionId();
    setSessionId(initSessionId);
    
    // Load preview immediately for welcome screen (FAST)
    loadWelcomePreview();
    
    // Load battles in background after initial render
    const loadTimer = setTimeout(() => {
      loadInitialBattles();
    }, 50); // Small delay to ensure UI renders first
    
    // Check for existing player
    const playerTimer = setTimeout(() => {
      checkExistingPlayer();
    }, 200); // Slightly longer delay
    
    // Leaderboard loaded only on game over
    
    return () => {
      clearTimeout(loadTimer);
      clearTimeout(playerTimer);
    };
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
        setScore(0); // Always start new games at 0 score
        setHighScore(data.player.best_score);
        
        // Reset player's current_score in database to 0 when starting new game
        updatePlayerStatsMutation.mutate({
          current_score: 0
        });
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

  // Create a new game session
  const createGameSession = async () => {
    try {
      const response = await fetch('/api/thumbnail-battle/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_session_id: sessionId
        })
      });
      const data = await response.json();
      if (data.game_id) {
        setCurrentGameId(data.game_id);
        setGameStartTime(Date.now());
        setBattlesInCurrentGame(0);
        setWinsInCurrentGame(0);
        return data.game_id;
      }
    } catch (error) {
      console.error('Error creating game session:', error);
    }
    return null;
  };

  // Update game session progress
  const updateGameSession = async (isGameOver: boolean = false) => {
    if (!currentGameId) return;
    
    try {
      await fetch('/api/thumbnail-battle/game', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: currentGameId,
          current_score: score,
          battles_played: battlesInCurrentGame,
          battles_won: winsInCurrentGame,
          lives_remaining: lives,
          is_game_over: isGameOver
        })
      });
    } catch (error) {
      console.error('Error updating game session:', error);
    }
  };


  // Mutation for updating player stats with optimistic updates
  const updatePlayerStatsMutation = useMutation({
    mutationFn: async (updates: Partial<Player>) => {
      if (!player) throw new Error('No player found');
      
      const response = await fetch('/api/thumbnail-battle/player', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: player.session_id,
          updates
        })
      });
      const data = await response.json();
      return data.player;
    },
    onMutate: async (updates) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['leaderboard'] });

      // Snapshot the previous value
      const previousLeaderboards = {
        best_games: queryClient.getQueryData(['leaderboard', 'best_games']),
        recent: queryClient.getQueryData(['leaderboard', 'recent'])
      };

      // Optimistically update leaderboard if this is a new high score
      if (updates.best_score && player) {
        const newEntry = {
          player_name: player.player_name,
          best_score: updates.best_score,
          total_battles: updates.total_battles || player.total_battles,
          total_wins: updates.total_wins || player.total_wins,
          accuracy: updates.total_battles ? (updates.total_wins || 0) / updates.total_battles * 100 : 0,
          created_at: new Date().toISOString()
        };

        // Update best_games leaderboard if new score would make it
        const bestGamesData = queryClient.getQueryData(['leaderboard', 'best_games']) as LeaderboardEntry[] | undefined;
        if (bestGamesData) {
          const updatedBestGames = [...bestGamesData];
          // Find if player already exists
          const existingIndex = updatedBestGames.findIndex(entry => entry.player_name === player.player_name);
          
          if (existingIndex >= 0) {
            // Update existing entry
            updatedBestGames[existingIndex] = newEntry;
          } else {
            // Add new entry
            updatedBestGames.push(newEntry);
          }
          
          // Sort by best_score descending and limit to 100
          updatedBestGames.sort((a, b) => b.best_score - a.best_score);
          updatedBestGames.splice(100);
          
          queryClient.setQueryData(['leaderboard', 'best_games'], updatedBestGames);
        }

        // Always add to recent games
        const recentData = queryClient.getQueryData(['leaderboard', 'recent']) as LeaderboardEntry[] | undefined;
        if (recentData) {
          const updatedRecent = [newEntry, ...recentData];
          updatedRecent.splice(100); // Keep only last 100
          queryClient.setQueryData(['leaderboard', 'recent'], updatedRecent);
        }
      }

      // Return a context object with the snapshotted value
      return { previousLeaderboards };
    },
    onError: (err, updates, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousLeaderboards) {
        queryClient.setQueryData(['leaderboard', 'best_games'], context.previousLeaderboards.best_games);
        queryClient.setQueryData(['leaderboard', 'recent'], context.previousLeaderboards.recent);
      }
      console.error('Error updating player:', err);
    },
    onSuccess: (updatedPlayer) => {
      setPlayer(updatedPlayer);
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we have correct data
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    }
  });

  // Fix avatar URL to use s88 (the largest size that works due to CORS)
  const fixAvatarUrl = (url: string | null): string | null => {
    if (!url) return null;
    // Replace any size parameter with s88 (the largest that works)
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
        // Include game_id if we have an active game session
        const url = currentGameId 
          ? `/api/thumbnail-battle/get-matchup?game_id=${currentGameId}`
          : '/api/thumbnail-battle/get-matchup';
        const response = await fetch(url);
        const data = await response.json();
        
        // Fix avatar URL if it exists (s176, s800, etc. don't work due to CORS)
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

  // Load preview for welcome screen (FAST - uses materialized view)
  const loadWelcomePreview = async () => {
    try {
      const response = await fetch('/api/thumbnail-battle/preview');
      const data = await response.json();
      if (data && data.videoA && data.videoB) {
        // Fix avatar URLs if they exist
        if (data.channel?.channel_avatar) {
          data.channel.channel_avatar = fixAvatarUrl(data.channel.channel_avatar);
        }
        setWelcomePreview(data);
      }
    } catch (error) {
      console.error('Failed to load preview:', error);
      // No big deal, welcome screen works without preview
    }
  };

  // Load initial battles on mount (runs in background)
  const loadInitialBattles = async () => {
    // Don't show loading spinner since this runs in background
    const matchups = await fetchMatchups(5);
    if (matchups.length > 0) {
      setBattle(matchups[0]);
      setBattleQueue(matchups.slice(1));
      return true;
    }
    return false;
  };

  // Get next battle from queue or fetch new ones
  const loadNewBattle = async (isInitial = false): Promise<boolean> => {
    // Don't reset timer here - only reset when moving to next round
    
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
      return true; // Successfully loaded from queue
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
        
        if (!isInitial) {
          setTransitioning(false);
        }
        return true; // Successfully fetched new battle
      } catch (error) {
        console.error('Failed to load battle:', error);
        if (!isInitial) {
          setTransitioning(false);
        }
        return false; // Failed to load battle
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

  const handleSelection = useCallback(async (selection: 'A' | 'B') => {
    if (gameState !== 'playing' || !battle || !battle.matchup_id) return;
    
    setSelectedVideo(selection);
    
    // Call the secure check-answer API
    const clickTime = Date.now();
    try {
      const response = await fetch('/api/thumbnail-battle/check-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchup_id: battle.matchup_id,
          selection,
          clicked_at: roundStartTime ? clickTime - roundStartTime : null,
          session_id: sessionId  // Include session ID for analytics
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
      
      // Update game session stats - only count battles that were actually answered
      setBattlesInCurrentGame(prev => prev + 1);
      if (correct) {
        setWinsInCurrentGame(prev => prev + 1);
      }

      if (correct) {
        const pointsEarned = result.points || 500;
        
        setLastPointsEarned(pointsEarned);
        const newScore = score + pointsEarned;
        setScore(newScore);
        
        if (newScore > highScore) {
          setHighScore(newScore);
        }
        
        // Update player stats in database
        if (player) {
          updatePlayerStatsMutation.mutate({
            current_score: newScore,
            best_score: Math.max(newScore, player.best_score),
            total_battles: player.total_battles + 1,
            total_wins: player.total_wins + 1
          });
        }
        
        // Update game session progress
        updateGameSession(false);
      } else {
        // Lose a life
        const newLives = lives - 1;
        setLives(newLives);
        setLastPointsEarned(null); // Clear points display on wrong answer
        
        // Update player stats for loss (but keep current score!)
        if (player) {
          updatePlayerStatsMutation.mutate({
            current_score: score, // Keep current score, don't reset to 0!
            total_battles: player.total_battles + 1,
            attempts_today: player.attempts_today + 1
          });
        }
        
        // Game over if no lives left
        if (newLives <= 0) {
          // Update game session as completed
          updateGameSession(true);
          
          setTimeout(() => {
            // Clear round state when game ends
            setRoundStartTime(null);
            setLastPointsEarned(null);
            setGameState('gameOver');
            // Leaderboard will be fetched automatically by React Query when gameState changes
          }, 2000);
        } else {
          // Update game session progress (not over yet)
          updateGameSession(false);
        }
      }
    } catch (error) {
      console.error('[ERROR] Failed to check answer:', error);
      // Fallback to prevent game from getting stuck
      setGameState('revealed');
    }
  }, [gameState, battle, score, lives, highScore, totalGames, correctPicks, player, roundStartTime, sessionId]);

  const handleNext = async () => {
    // Clear results for new round
    setSelectedVideo(null);
    setIsCorrect(null);
    setLastPointsEarned(null); // Clear points display
    
    // Load new battle and transition
    const success = await loadNewBattle();
    
    if (success) {
      setGameState('playing');
      // Timer will be reset by the useEffect when gameState changes to 'playing'
    } else {
    }
  };

  const handleRestart = async () => {
    // Reset all game state
    setScore(0);
    setLives(3);
    setSelectedVideo(null);
    setIsCorrect(null);
    setLastPointsEarned(null);
    setRoundStartTime(null);
    
    // Reset game session variables
    setCurrentGameId(null);
    setGameStartTime(null);
    setBattlesInCurrentGame(0);
    setWinsInCurrentGame(0);
    
    // Load a fresh battle before transitioning to start
    setTransitioning(true);
    const success = await loadNewBattle();
    setTransitioning(false);
    
    if (success) {
      setGameState('start');
    } else {
      // If loading fails, try loading initial battles
      await loadInitialBattles();
      setGameState('start');
    }
    
    // Reset current streak for player
    if (player) {
      updatePlayerStatsMutation.mutate({
        current_score: 0,
        attempts_today: player.attempts_today + 1
      });
    }
  };

  const handleStartGame = async () => {
    // Create a new game session
    const gameId = await createGameSession();
    if (!gameId) {
      console.error('Failed to create game session');
    }
    
    // Ensure we have a battle before starting
    let hasLoadedBattle = !!battle;
    
    if (!battle) {
      setTransitioning(true);
      const success = await loadNewBattle();
      setTransitioning(false);
      if (!success) {
        // If loading fails, try loading initial battles
        const fallbackSuccess = await loadInitialBattles();
        hasLoadedBattle = fallbackSuccess;
      } else {
        hasLoadedBattle = true;
      }
    }
    
    // Transition to playing state - we either had a battle or just loaded one
    if (hasLoadedBattle) {
      setGameState('playing');
    }
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

  const [leaderboardContext, setLeaderboardContext] = useState<any[]>([]);
  const [playerRank, setPlayerRank] = useState<number | null>(null);

  // Fetch leaderboard context when game ends
  useEffect(() => {
    if (gameState === 'gameOver' && player) {
      const finalScore = Math.max(score, player.best_score || 0);
      
      // Use new leaderboard context API for accurate ranking
      fetch(`/api/thumbnail-battle/leaderboard-context?player_name=${encodeURIComponent(player.player_name)}&final_score=${finalScore}`)
        .then(res => res.json())
        .then(data => {
          if (data.leaderboard_context) {
            setLeaderboardContext(data.leaderboard_context);
            setPlayerRank(data.player_rank);
          }
        })
        .catch(console.error);
    }
  }, [gameState, player, score]);

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
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <motion.div
          className="w-full max-w-md flex flex-col items-center text-center"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-5xl font-bold mb-8">GAME OVER</h1>
          
          {/* Leaderboard context - no scrolling */}
          {leaderboardContext.length > 0 ? (
            <div className="w-full mb-8">
              <div className="font-mono text-lg space-y-2">
                {leaderboardContext.map((entry) => (
                  <div
                    key={entry.rank}
                    className={`flex items-center justify-between px-2 ${
                      entry.is_current_player ? 'text-[#00ff00]' : 'text-white/70'
                    }`}
                    style={{
                      textShadow: entry.is_current_player ? '0 0 10px rgba(0, 255, 0, 0.3)' : 'none'
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <span className="w-12 text-right">#{entry.rank}</span>
                      <span className="text-left">
                        {entry.player_name}
                      </span>
                    </div>
                    <span className="font-bold tabular-nums">
                      {entry.best_score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Fallback if leaderboard fetch fails or is loading
            <div className="mb-8">
              <div className="text-2xl mb-2">Score: {score}</div>
              {playerRank && (
                <div className="text-lg text-muted-foreground">Rank: #{playerRank}</div>
              )}
            </div>
          )}
          
          <button 
            className="bg-[#00ff00] text-black rounded-lg py-3 px-8 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors mb-4"
            onClick={handleRestart}
          >
            Play Again
          </button>
          
          <p className="text-sm text-muted-foreground">
            25+ million battles await - can you beat your high score?
          </p>
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
    const otherVideo = side === 'A' ? battle.videoB : battle.videoA;
    const isWinner = video.temporal_performance_score && otherVideo.temporal_performance_score 
      ? video.temporal_performance_score > otherVideo.temporal_performance_score
      : false;
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
        {/* Thumbnail with full aspect ratio - just smaller on mobile */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-secondary mb-2 sm:mb-4 lg:mb-6">
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
                    <>
                      <Check className="w-16 h-16 text-[#00ff00] mx-auto" />
                      {lastPointsEarned && (
                        <div className="mt-2 text-2xl font-bold text-[#00ff00]">
                          +{lastPointsEarned} points
                        </div>
                      )}
                    </>
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
          
        </div>
        
        {/* Responsive title - smaller on mobile to fit without scroll */}
        <h3 className="text-sm sm:text-xl lg:text-2xl font-semibold leading-tight sm:leading-relaxed line-clamp-2">
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
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-1.5 sm:py-3">
              <div className="flex items-center justify-between">
                {/* Left side - Logo and live points */}
                <div className="flex items-center gap-2 sm:gap-6">
                  <div className="flex items-center gap-1 sm:gap-3">
                    <Axe className="w-4 h-4 sm:w-6 sm:h-6 text-[#00ff00]" />
                    <span className="text-xs sm:text-lg font-semibold hidden sm:inline">Thumbnail Battle</span>
                  </div>
                  {/* Live points display - compact on mobile */}
                  {gameState === 'playing' && roundStartTime && (
                    <LiveScoreDisplay startTime={roundStartTime} />
                  )}
                </div>
                
                {/* Right side - Score, Best, Lives - more compact on mobile */}
                <div className="flex items-center gap-2 sm:gap-6">
                  {/* Score - compact mobile display */}
                  <div className={`flex items-center gap-1 ${
                    score >= 5 ? 'text-[#00ff00]' : ''
                  }`}>
                    <span className="text-xs uppercase tracking-wider hidden sm:inline">Score</span>
                    <span className="font-bold text-sm sm:text-base">
                      {score}
                    </span>
                  </div>
                  
                  {/* Best score - hide on mobile to save space */}
                  {player && player.best_score > 0 && (
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wider">Best</span>
                      <span className="font-bold text-base">
                        {player.best_score}
                      </span>
                    </div>
                  )}
                  
                  {/* Lives - smaller on mobile */}
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
          // Welcome screen with name entry
          <motion.div
            key="welcome"
            className="relative min-h-screen flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="max-w-4xl w-full">
              {/* Thumbnail preview - uses fast preview endpoint or falls back to battleQueue */}
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
                  </motion.div>
                </motion.div>
              ) : (
                // Loading state - shows immediately while preview loads
                <div className="flex items-center justify-center gap-10 mb-12 h-[216px]">
                  <div className="relative w-96 aspect-video rounded-lg bg-gray-800 animate-pulse" />
                  <span className="text-3xl font-bold text-gray-600">VS</span>
                  <div className="relative w-96 aspect-video rounded-lg bg-gray-800 animate-pulse" />
                </div>
              )}

              {/* Question with fade-in animation */}
              <motion.div 
                className="text-center mb-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <p className="text-3xl font-semibold">Can you spot the winner?</p>
              </motion.div>

              {/* Simple underline input field and narrower button */}
              <div className="flex flex-col items-center space-y-6">
                <label htmlFor="player-name" className="sr-only">Enter your name</label>
                <input
                  id="player-name"
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
                  <h1 className="text-5xl font-bold mb-4 tracking-tight">Thumbnail Battle</h1>
                  <div className="max-w-2xl mx-auto">
                    <p className="text-lg text-muted-foreground mb-3">
                      Which video beat the average?
                    </p>
                    <p className="text-base text-muted-foreground tracking-wide mb-8">
                      <span className="font-medium">10 seconds</span>
                      <span className="mx-2 opacity-50">•</span>
                      <span className="font-medium">3 lives</span>
                      <span className="mx-2 opacity-50">•</span>
                      <span className="font-medium">1 channel</span>
                    </p>
                  </div>
                </motion.div>

                {/* Just the button, no card */}
                <div className="flex justify-center">
                  <button
                    className="bg-[#00ff00] text-black rounded-lg py-3 px-8 text-lg font-semibold hover:bg-[#00ff00]/90 transition-colors disabled:opacity-50"
                    onClick={handleStartGame}
                    disabled={!battle}
                  >
                    {battle ? 'Battle!' : 'Loading...'}
                  </button>
                </div>

                {/* Bottom options */}
                <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 flex gap-8">
                  <button
                    className="text-gray-600 hover:text-[#00ff00] transition-colors text-xs uppercase tracking-wider"
                    onClick={() => {
                      setShowLeaderboard(true);
                      // React Query will automatically fetch the current leaderboardType
                    }}
                  >
                    VIEW LEADERBOARD
                  </button>
                  <button
                    className="text-gray-600 hover:text-[#00ff00] transition-colors text-xs uppercase tracking-wider"
                    onClick={handleResetPlayer}
                  >
                    SWITCH PLAYER
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
                      onError={(e) => {
                        // Hide image and show fallback
                        const img = e.target as HTMLImageElement;
                        img.style.display = 'none';
                        const fallback = img.nextElementSibling as HTMLElement;
                        if (fallback) {
                          fallback.classList.remove('hidden');
                        }
                      }}
                    />
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm sm:text-lg font-bold text-white hidden flex-shrink-0">
                      {battle.channel.channel_title?.charAt(0)?.toUpperCase() || '?'}
                    </div>
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

            {/* Video comparison - stacked on mobile, side-by-side on desktop */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-8 md:gap-12 max-w-[1400px] w-full mx-auto mb-4 sm:mb-8 mt-2 sm:mt-8 px-2 sm:px-4 lg:px-8">
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
                      className="bg-[#00ff00] text-black rounded-lg py-2 sm:py-3 px-6 sm:px-8 text-sm sm:text-base font-semibold hover:bg-[#00ff00]/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50"
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

      {/* Removed live timer display from bottom - now in header */}

      {/* Leaderboard Modal */}
      <AnimatePresence>
        {showLeaderboard && (
          <motion.div
            className="fixed inset-0 bg-black z-50 flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            onClick={() => setShowLeaderboard(false)}
          >
            <motion.div
              className="max-w-lg w-full max-h-[90vh] flex flex-col"
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.98, opacity: 0, y: 4 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-6 text-center flex-shrink-0 relative">
                <button
                  className="absolute top-0 right-0 p-2 text-white/60 hover:text-white transition-colors"
                  onClick={() => setShowLeaderboard(false)}
                  aria-label="Close leaderboard"
                >
                  <X className="w-6 h-6" />
                </button>
                <h2 className="text-3xl sm:text-4xl font-bold mb-4">Leaderboard</h2>
                
                {/* Tabs - simple text approach */}
                <div className="flex justify-center gap-6 mb-2">
                  <button
                    className={`text-sm font-medium transition-colors ${
                      leaderboardType === 'best_games'
                        ? 'text-[#00ff00]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    onClick={() => {
                      setLeaderboardType('best_games');
                      // React Query will automatically fetch if not cached
                    }}
                  >
                    Top Scores
                  </button>
                  <button
                    className={`text-sm font-medium transition-colors ${
                      leaderboardType === 'recent'
                        ? 'text-[#00ff00]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    onClick={() => {
                      setLeaderboardType('recent');
                      // React Query will automatically fetch if not cached
                    }}
                  >
                    Recent Games
                  </button>
                </div>
              </div>

              {leaderboardLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Loading...</p>
                </div>
              ) : leaderboard.length > 0 ? (
                <div className="font-mono text-xl space-y-3 overflow-y-auto flex-1 scrollbar-hide">
                  {leaderboard.map((entry, index) => (
                    <div
                      key={`${entry.player_name}-${entry.best_score}-${entry.created_at}`}
                      className={`flex items-center justify-between ${
                        leaderboardType === 'best_games' && index < 3 ? 'text-[#00ff00]' : 'text-white/90'
                      } ${leaderboardType === 'best_games' && index === 0 ? 'text-2xl' : ''}`}
                      style={{
                        textShadow: leaderboardType === 'best_games' && index < 3 ? '0 0 10px rgba(0, 255, 0, 0.3)' : 'none'
                      }}
                    >
                      <div className={`grid ${leaderboardType === 'recent' ? 'grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto]' : 'grid-cols-[2rem_1fr_auto_auto] sm:grid-cols-[3rem_1fr_auto_auto]'} gap-3 sm:gap-6 items-center w-full`}>
                        {leaderboardType !== 'recent' && (
                          <span className="text-right tabular-nums text-base sm:text-lg font-semibold">
                            {index + 1}.
                          </span>
                        )}
                        <span className="truncate text-base sm:text-lg font-semibold min-w-0">
                          {entry.player_name}
                        </span>
                        <span className="font-black tabular-nums text-base sm:text-lg text-right min-w-16">
                          {entry.best_score.toLocaleString()}
                        </span>
                        <div className="text-xs sm:text-sm font-semibold tracking-wider uppercase text-white/50 tabular-nums whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleDateString([], { 
                            month: 'numeric', 
                            day: 'numeric' 
                          })} {new Date(entry.created_at).toLocaleTimeString([], { 
                            hour: 'numeric', 
                            minute: '2-digit',
                            hour12: false 
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No results found</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
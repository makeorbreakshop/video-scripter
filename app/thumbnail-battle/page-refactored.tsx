'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Heart, Axe, Eye, X, Check, ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';

// ============= TYPES =============
interface Video {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
  temporal_performance_score?: number;
  view_count: number;
}

interface Channel {
  channel_title: string;
  channel_avatar: string | null;
  channel_subscriber_count: number;
}

interface Battle {
  matchup_id?: string;
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

type GameState = 'start' | 'playing' | 'reveal' | 'gameover' | 'loading';

// ============= UTILITIES =============
function formatSubscriberCount(count: number): string {
  if (!count) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
  return count.toString();
}

// ============= COMPONENTS =============

// Layout wrapper that handles consistent spacing and scrolling
function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background overflow-y-auto">
      <div className="container mx-auto px-4 py-8">
        {children}
      </div>
    </div>
  );
}

// Start Screen Component
function StartScreen({ 
  onStart, 
  player,
  isLoading 
}: { 
  onStart: (name: string) => void;
  player: Player | null;
  isLoading: boolean;
}) {
  const [playerName, setPlayerName] = useState(player?.player_name || '');

  const handleStart = () => {
    const name = playerName.trim() || 'Anonymous';
    onStart(name);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center justify-center min-h-[80vh]"
    >
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-5xl font-bold mb-4 tracking-tight">
          Thumbnail Battle
        </h1>
        
        <p className="text-lg text-muted-foreground mb-3">
          Which video beat the average?
        </p>
        
        <p className="text-base text-muted-foreground tracking-wide mb-8">
          <span className="font-medium">3 lives</span>
          <span className="mx-2 opacity-50">•</span>
          <span className="font-medium">2 videos</span>
          <span className="mx-2 opacity-50">•</span>
          <span className="font-medium">1 channel</span>
        </p>

        {player && (
          <div className="mb-6 p-4 bg-muted/30 rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Welcome back!</p>
            <p className="font-medium">{player.player_name}</p>
            <p className="text-sm text-muted-foreground">Best: {player.best_score} points</p>
          </div>
        )}

        <div className="space-y-4">
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name (optional)"
            className="w-full px-4 py-3 bg-background border rounded-lg text-center"
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            disabled={isLoading}
          />
          
          <button
            onClick={handleStart}
            disabled={isLoading}
            className="w-full px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Battle!'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Game Over Screen Component
function GameOverScreen({ 
  score,
  player,
  leaderboard,
  onRestart,
  isLoadingLeaderboard
}: {
  score: number;
  player: Player | null;
  leaderboard: LeaderboardEntry[];
  onRestart: () => void;
  isLoadingLeaderboard: boolean;
}) {
  const playerRank = leaderboard.findIndex(entry => 
    entry.player_name === player?.player_name
  ) + 1;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="flex flex-col items-center max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Game Over!</h1>
        <p className="text-2xl mb-2">Final Score: {score}</p>
        {player && player.best_score >= score && (
          <p className="text-lg text-muted-foreground">
            Personal Best: {player.best_score}
          </p>
        )}
        {player && player.best_score < score && (
          <p className="text-lg text-green-500 font-medium">
            New Personal Best! 🎉
          </p>
        )}
      </div>

      {/* Leaderboard */}
      <div className="w-full mb-8">
        <h2 className="text-2xl font-bold mb-4 text-center">Leaderboard</h2>
        
        <div className="bg-muted/10 rounded-lg p-4 max-h-[400px] overflow-y-auto">
          {isLoadingLeaderboard ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading leaderboard...
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No scores yet. Be the first!
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((entry, index) => (
                <div
                  key={`${entry.player_name}-${index}`}
                  className={`p-3 rounded-lg flex items-center justify-between ${
                    entry.player_name === player?.player_name
                      ? 'bg-primary/20 border border-primary/40'
                      : 'bg-muted/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold w-8">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium">{entry.player_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {entry.total_battles} battles • {entry.accuracy.toFixed(1)}% accuracy
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{entry.best_score}</p>
                    <p className="text-xs text-muted-foreground">points</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={onRestart}
        className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
      >
        Play Again
      </button>
    </motion.div>
  );
}

// Timer Display Component
function TimerDisplay({ startTime }: { startTime: number }) {
  const [points, setPoints] = useState(1000);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      let newPoints = 500;
      
      if (elapsed <= 500) {
        newPoints = 1000;
      } else if (elapsed < 10000) {
        const progress = (elapsed - 500) / 9500;
        newPoints = Math.floor(1000 - (500 * progress));
      }
      
      setPoints(newPoints);
    }, 50);

    return () => clearInterval(interval);
  }, [startTime]);

  const color = points >= 900 ? '#00ff00' : 
                points >= 700 ? '#88ff00' : 
                points >= 600 ? '#ffaa00' : '#ff6600';

  return (
    <div className="text-center">
      <span style={{ color }} className="text-2xl font-bold">
        {points}
      </span>
      <span className="text-sm text-muted-foreground ml-1">pts</span>
    </div>
  );
}

// Game Screen Component
function GameScreen({
  battle,
  lives,
  score,
  roundStartTime,
  onSelect,
  isRevealing,
  selectedVideo,
  correctVideo,
  roundScore
}: {
  battle: Battle;
  lives: number;
  score: number;
  roundStartTime: number;
  onSelect: (videoId: string) => void;
  isRevealing: boolean;
  selectedVideo: string | null;
  correctVideo: string | null;
  roundScore: number;
}) {
  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex gap-1">
          {[...Array(3)].map((_, i) => (
            <Heart
              key={i}
              className={`w-6 h-6 ${
                i < lives ? 'fill-red-500 text-red-500' : 'text-gray-600'
              }`}
            />
          ))}
        </div>
        
        <TimerDisplay startTime={roundStartTime} />
        
        <div className="text-lg font-medium">
          Score: {score}
        </div>
      </div>

      {/* Channel Info */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-3 mb-2">
          {battle.channel.channel_avatar && (
            <img
              src={battle.channel.channel_avatar}
              alt={battle.channel.channel_title}
              className="w-10 h-10 rounded-full"
            />
          )}
          <h2 className="text-xl font-bold">{battle.channel.channel_title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatSubscriberCount(battle.channel.channel_subscriber_count)} subscribers
        </p>
      </div>

      {/* Videos */}
      <div className="grid md:grid-cols-2 gap-8">
        {[battle.videoA, battle.videoB].map((video) => (
          <motion.div
            key={video.id}
            whileHover={!isRevealing ? { scale: 1.02 } : {}}
            className="relative"
          >
            <button
              onClick={() => onSelect(video.id)}
              disabled={isRevealing}
              className={`w-full text-left ${
                isRevealing ? 'cursor-default' : 'cursor-pointer'
              }`}
            >
              <div className="relative aspect-video rounded-lg overflow-hidden mb-3">
                <img
                  src={video.thumbnail_url}
                  alt={video.title}
                  className="w-full h-full object-cover"
                />
                
                {/* Result overlay */}
                {isRevealing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`absolute inset-0 flex items-center justify-center ${
                      video.id === correctVideo
                        ? 'bg-green-500/80'
                        : video.id === selectedVideo
                        ? 'bg-red-500/80'
                        : 'bg-black/50'
                    }`}
                  >
                    {video.id === correctVideo ? (
                      <Check className="w-16 h-16 text-white" />
                    ) : video.id === selectedVideo ? (
                      <X className="w-16 h-16 text-white" />
                    ) : null}
                  </motion.div>
                )}
              </div>
              
              <h3 className="font-medium line-clamp-2 mb-2">{video.title}</h3>
              
              {isRevealing && video.temporal_performance_score && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-2 p-2 bg-muted/50 rounded"
                >
                  <p className="text-sm">
                    Performance: {(video.temporal_performance_score * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {video.view_count.toLocaleString()} views
                  </p>
                </motion.div>
              )}
            </button>
          </motion.div>
        ))}
      </div>

      {/* Round score display */}
      {isRevealing && roundScore > 0 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="text-center mt-6"
        >
          <p className="text-2xl font-bold text-green-500">+{roundScore}</p>
        </motion.div>
      )}
    </div>
  );
}

// ============= MAIN COMPONENT =============
export default function ThumbnailBattlePage() {
  // Core game state
  const [gameState, setGameState] = useState<GameState>('start');
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerName, setPlayerName] = useState('');
  
  // Game data
  const [currentBattle, setCurrentBattle] = useState<Battle | null>(null);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [roundStartTime, setRoundStartTime] = useState(0);
  
  // Round state
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [correctVideo, setCorrectVideo] = useState<string | null>(null);
  const [roundScore, setRoundScore] = useState(0);
  
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);

  // Initialize player on mount
  useEffect(() => {
    const initPlayer = async () => {
      try {
        const sessionId = localStorage.getItem('session_id') || crypto.randomUUID();
        localStorage.setItem('session_id', sessionId);
        
        const response = await fetch('/api/thumbnail-battle/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        });
        
        if (response.ok) {
          const data = await response.json();
          setPlayer(data);
        }
      } catch (error) {
        console.error('Failed to initialize player:', error);
      }
    };
    
    initPlayer();
  }, []);

  // Start new game
  const startGame = useCallback(async (name: string) => {
    setPlayerName(name);
    setGameState('loading');
    setLives(3);
    setScore(0);
    
    // Update player name if needed
    if (player && name !== player.player_name) {
      try {
        await fetch('/api/thumbnail-battle/player', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: player.id,
            player_name: name
          })
        });
        setPlayer({ ...player, player_name: name });
      } catch (error) {
        console.error('Failed to update player name:', error);
      }
    }
    
    // Load first battle
    await loadNewBattle();
    setGameState('playing');
  }, [player]);

  // Load new battle
  const loadNewBattle = useCallback(async () => {
    try {
      const response = await fetch('/api/thumbnail-battle/matchup');
      if (!response.ok) throw new Error('Failed to fetch matchup');
      
      const battle = await response.json();
      setCurrentBattle(battle);
      setRoundStartTime(Date.now());
      setSelectedVideo(null);
      setCorrectVideo(null);
      setRoundScore(0);
    } catch (error) {
      console.error('Failed to load battle:', error);
    }
  }, []);

  // Handle video selection
  const handleVideoSelect = useCallback(async (videoId: string) => {
    if (!currentBattle || selectedVideo) return;
    
    setSelectedVideo(videoId);
    setGameState('reveal');
    
    // Calculate score
    const elapsed = Date.now() - roundStartTime;
    let points = 500;
    if (elapsed <= 500) {
      points = 1000;
    } else if (elapsed < 10000) {
      const progress = (elapsed - 500) / 9500;
      points = Math.floor(1000 - (500 * progress));
    }
    
    // Check answer
    try {
      const response = await fetch('/api/thumbnail-battle/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchup_id: currentBattle.matchup_id,
          selected_video_id: videoId,
          player_id: player?.id
        })
      });
      
      const result = await response.json();
      setCorrectVideo(result.correct_video_id);
      
      if (result.is_correct) {
        setScore(score + points);
        setRoundScore(points);
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      } else {
        setLives(lives - 1);
      }
      
      // Update battle with scores
      setCurrentBattle({
        ...currentBattle,
        videoA: result.videoA,
        videoB: result.videoB
      });
      
      // Continue or end game
      setTimeout(() => {
        if (!result.is_correct && lives <= 1) {
          endGame();
        } else {
          nextRound();
        }
      }, 3000);
      
    } catch (error) {
      console.error('Failed to check answer:', error);
    }
  }, [currentBattle, selectedVideo, roundStartTime, score, lives, player]);

  // Next round
  const nextRound = useCallback(async () => {
    setGameState('loading');
    await loadNewBattle();
    setGameState('playing');
  }, [loadNewBattle]);

  // End game
  const endGame = useCallback(async () => {
    setGameState('gameover');
    
    // Save final score
    if (player) {
      try {
        await fetch('/api/thumbnail-battle/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: player.id,
            score: score
          })
        });
      } catch (error) {
        console.error('Failed to save score:', error);
      }
    }
    
    // Load leaderboard
    setIsLoadingLeaderboard(true);
    try {
      const response = await fetch('/api/thumbnail-battle/leaderboard');
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data);
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, [player, score]);

  // Restart game
  const restartGame = useCallback(() => {
    startGame(playerName);
  }, [playerName, startGame]);

  return (
    <GameLayout>
      <AnimatePresence mode="wait">
        {gameState === 'start' && (
          <StartScreen
            key="start"
            onStart={startGame}
            player={player}
            isLoading={false}
          />
        )}
        
        {gameState === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center min-h-[80vh]"
          >
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Loading battle...</p>
            </div>
          </motion.div>
        )}
        
        {(gameState === 'playing' || gameState === 'reveal') && currentBattle && (
          <GameScreen
            key="game"
            battle={currentBattle}
            lives={lives}
            score={score}
            roundStartTime={roundStartTime}
            onSelect={handleVideoSelect}
            isRevealing={gameState === 'reveal'}
            selectedVideo={selectedVideo}
            correctVideo={correctVideo}
            roundScore={roundScore}
          />
        )}
        
        {gameState === 'gameover' && (
          <GameOverScreen
            key="gameover"
            score={score}
            player={player}
            leaderboard={leaderboard}
            onRestart={restartGame}
            isLoadingLeaderboard={isLoadingLeaderboard}
          />
        )}
      </AnimatePresence>
    </GameLayout>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import confetti from 'canvas-confetti';

interface Video {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_title: string;
  channel_subscriber_count: number;
  temporal_performance_score: number;
  view_count: number;
}

interface Battle {
  videoA: Video;
  videoB: Video;
}

export default function ThumbnailBattlePage() {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [streak, setStreak] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameState, setGameState] = useState<'playing' | 'revealed' | 'gameOver'>('playing');
  const [selectedVideo, setSelectedVideo] = useState<'A' | 'B' | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalGames, setTotalGames] = useState(0);
  const [correctPicks, setCorrectPicks] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('thumbnailBattleHighScore');
    const games = localStorage.getItem('thumbnailBattleTotalGames');
    const correct = localStorage.getItem('thumbnailBattleCorrectPicks');
    
    if (saved) setHighScore(parseInt(saved));
    if (games) setTotalGames(parseInt(games));
    if (correct) setCorrectPicks(parseInt(correct));
    
    loadNewBattle();
  }, []);

  const loadNewBattle = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/thumbnail-battle/get-matchup');
      const data = await response.json();
      setBattle(data);
      setGameState('playing');
      setSelectedVideo(null);
      setIsCorrect(null);
    } catch (error) {
      console.error('Failed to load battle:', error);
    } finally {
      setLoading(false);
    }
  };

  const triggerConfetti = () => {
    // Subtle confetti - less is more
    confetti({
      particleCount: 30,
      spread: 50,
      origin: { y: 0.6 }
    });
  };

  const handleSelection = (selection: 'A' | 'B') => {
    if (gameState !== 'playing') return;

    setSelectedVideo(selection);
    
    const winner = battle!.videoA.temporal_performance_score > battle!.videoB.temporal_performance_score ? 'A' : 'B';
    const correct = selection === winner;
    
    setIsCorrect(correct);
    setGameState('revealed');
    
    // Update stats
    const newTotal = totalGames + 1;
    const newCorrect = correctPicks + (correct ? 1 : 0);
    setTotalGames(newTotal);
    setCorrectPicks(newCorrect);
    localStorage.setItem('thumbnailBattleTotalGames', newTotal.toString());
    localStorage.setItem('thumbnailBattleCorrectPicks', newCorrect.toString());

    if (correct) {
      const newStreak = streak + 1;
      setStreak(newStreak);
      
      // Celebrate milestones
      if (newStreak === 5 || newStreak === 10 || newStreak === 20) {
        triggerConfetti();
      }
      
      if (newStreak > highScore) {
        setHighScore(newStreak);
        localStorage.setItem('thumbnailBattleHighScore', newStreak.toString());
      }
    } else {
      setTimeout(() => {
        setGameState('gameOver');
      }, 2000);
    }
  };

  const handleNext = () => {
    if (isCorrect) {
      loadNewBattle();
    }
  };

  const handleRestart = () => {
    setStreak(0);
    loadNewBattle();
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.round(num / 1000)}K`;
    return num.toString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (gameState === 'gameOver') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="max-w-sm w-full">
          <div className="text-center space-y-6">
            <div>
              <div className="text-6xl font-bold text-gray-900">{streak}</div>
              <div className="text-gray-500 mt-2">Final streak</div>
            </div>
            
            <div className="py-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Best streak</span>
                <span className="font-semibold text-gray-900">{highScore}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Accuracy</span>
                <span className="font-semibold text-gray-900">
                  {totalGames > 0 ? Math.round((correctPicks / totalGames) * 100) : 0}%
                </span>
              </div>
            </div>

            <Button 
              onClick={handleRestart} 
              size="lg"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white"
            >
              Play Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!battle) return null;

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
        onClick={onClick}
        disabled={gameState !== 'playing'}
        className={`
          group relative w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-4 rounded-lg
          ${gameState === 'playing' ? 'cursor-pointer' : ''}
        `}
      >
        <Card className={`
          overflow-hidden border-2 transition-all duration-200
          ${gameState === 'playing' ? 'border-gray-200 hover:border-gray-400' : ''}
          ${showResult && isSelected ? 
            isCorrect ? 'border-green-500' : 'border-red-500' 
            : showResult && !isSelected && isWinner ? 'border-gray-300' : 'border-gray-200'
          }
        `}>
          <div className="relative">
            {/* Large letter indicator - more obvious than small badge */}
            <div className={`
              absolute top-4 left-4 z-10 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg
              ${gameState === 'playing' 
                ? 'bg-white/90 text-gray-900 backdrop-blur-sm' 
                : 'bg-white text-gray-900'
              }
            `}>
              {side}
            </div>
            
            {/* Thumbnail */}
            <div className="aspect-video bg-gray-100">
              <img 
                src={video.thumbnail_url} 
                alt={video.title}
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Result overlay - simpler, clearer */}
            <AnimatePresence>
              {showResult && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`
                    absolute inset-0 flex items-center justify-center
                    ${isSelected ? 
                      isCorrect ? 'bg-green-500/95' : 'bg-red-500/95'
                      : isWinner ? 'bg-gray-900/80' : 'bg-white/90'
                    }
                  `}
                >
                  <div className="text-center">
                    {isSelected && (
                      <div className="text-white mb-2">
                        {isCorrect ? (
                          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className={`text-4xl font-bold ${isSelected || isWinner ? 'text-white' : 'text-gray-900'}`}>
                      {video.temporal_performance_score.toFixed(1)}×
                    </div>
                    <div className={`text-sm mt-1 ${isSelected || isWinner ? 'text-white/90' : 'text-gray-500'}`}>
                      baseline
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Title - clear hierarchy */}
          <div className="p-4">
            <h3 className="font-medium text-gray-900 line-clamp-2">
              {video.title}
            </h3>
          </div>
        </Card>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Minimal header - focus on game */}
      <div className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">Thumbnail Battle</h1>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-gray-500">
                Streak <span className="font-bold text-gray-900 ml-1">{streak}</span>
              </div>
              <div className="text-gray-500">
                Best <span className="font-bold text-gray-900 ml-1">{highScore}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main game area - clean, focused */}
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Simple, clear instruction */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Which performed better?
          </h2>
          <p className="text-gray-500 mt-2">
            Choose the thumbnail that got more views vs its channel average
          </p>
        </div>

        {/* Game grid - optimal spacing */}
        <div className="grid md:grid-cols-2 gap-8">
          <VideoCard 
            video={battle.videoA} 
            side="A" 
            onClick={() => handleSelection('A')}
          />
          <VideoCard 
            video={battle.videoB} 
            side="B" 
            onClick={() => handleSelection('B')}
          />
        </div>

        {/* Action area - clear primary action */}
        <div className="mt-8 flex justify-center">
          <AnimatePresence mode="wait">
            {gameState === 'revealed' && isCorrect && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Button 
                  onClick={handleNext} 
                  size="lg"
                  className="bg-gray-900 hover:bg-gray-800 text-white px-8"
                >
                  Next Round
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
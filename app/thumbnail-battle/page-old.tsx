'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import './globals.css';

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
      if (newStreak % 5 === 0) {
        triggerConfetti();
      }
      
      if (newStreak > highScore) {
        setHighScore(newStreak);
        localStorage.setItem('thumbnailBattleHighScore', newStreak.toString());
        if (newStreak > 1) {
          triggerConfetti();
        }
      }
    } else {
      setTimeout(() => {
        setGameState('gameOver');
      }, 2000);
    }
  }, [gameState, battle, streak, highScore, totalGames, correctPicks]);

  const handleNext = () => {
    if (isCorrect) {
      loadNewBattle();
    }
  };

  const handleRestart = () => {
    setStreak(0);
    loadNewBattle();
  };

  // Keyboard shortcuts - placed after ALL functions are defined
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
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
      if (gameState === 'revealed' && isCorrect && e.key === 'Enter') {
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
  }, [gameState, isCorrect, handleSelection, handleNext, handleRestart]);


  const accuracy = totalGames > 0 ? Math.round((correctPicks / totalGames) * 100) : 0;

  if (loading) {
    return (
      <div className="tb-loading-container">
        <div className="tb-spinner"></div>
      </div>
    );
  }

  if (gameState === 'gameOver') {
    return (
      <div className="thumbnail-battle-container">
        <motion.div
          className="tb-game-over-card"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="tb-game-over-icon"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </motion.div>
          
          <h1 className="tb-game-over-title">Game Over</h1>
          <p className="tb-game-over-subtitle">Great effort! Ready for another round?</p>
          
          <div className="tb-stats-grid">
            <div className="tb-stat-card">
              <span className="tb-stat-label">Final Streak</span>
              <span className="tb-stat-value">{streak}</span>
            </div>
            
            <div className="tb-stat-card tb-highlight">
              <span className="tb-stat-label">Best Streak</span>
              <span className="tb-stat-value">{highScore} 🏆</span>
            </div>

            <div className="tb-stat-card">
              <span className="tb-stat-label">Accuracy</span>
              <span className="tb-stat-value">{accuracy}%</span>
            </div>

            <div className="tb-stat-card">
              <span className="tb-stat-label">Total Games</span>
              <span className="tb-stat-value">{totalGames}</span>
            </div>
          </div>
          
          <button className="tb-play-again-btn" onClick={handleRestart}>
            Play Again
          </button>
        </motion.div>
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
      <motion.button
        className={`tb-battle-card ${showResult && isSelected ? (isCorrect ? 'tb-correct' : 'tb-incorrect') : ''} ${showResult && !isSelected && isWinner ? 'tb-winner' : ''} ${gameState !== 'playing' ? 'tb-disabled' : ''}`}
        onClick={onClick}
        disabled={gameState !== 'playing'}
        whileHover={gameState === 'playing' ? { scale: 1.02 } : {}}
        whileTap={gameState === 'playing' ? { scale: 0.98 } : {}}
        animate={isSelected && showResult ? 
          isCorrect ? { scale: [1, 1.05, 1] } : { x: [0, -10, 10, -10, 10, 0] } 
          : {}
        }
      >
        <div className="tb-option-indicator">{side}</div>
        
        <div className="tb-thumbnail-wrapper">
          <img 
            src={video.thumbnail_url} 
            alt={video.title}
            className="tb-thumbnail"
          />
          
          <AnimatePresence>
            {showResult && (
              <motion.div
                className={`tb-result-overlay ${isSelected ? (isCorrect ? 'tb-correct' : 'tb-incorrect') : isWinner ? 'tb-winner' : 'tb-loser'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {isSelected && (
                  <motion.div
                    className="tb-result-icon"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                  >
                    {isCorrect ? '✓' : '✗'}
                  </motion.div>
                )}
                
                <motion.div
                  className="tb-result-stats"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="tb-performance-score">
                    {video.temporal_performance_score.toFixed(1)}x
                  </div>
                  <div className="tb-performance-label">
                    channel average
                  </div>
                  <div className="tb-view-count">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    {video.view_count.toLocaleString()} views
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <h3 className="tb-video-title">
          {video.title}
        </h3>
      </motion.button>
    );
  };

  return (
    <div className="thumbnail-battle-container">
      {/* Fixed stats bar */}
      <div className="tb-stats-bar">
        <div className="tb-stats-container">
          <div className="tb-game-logo">
            <span className="tb-logo-icon">🎯</span>
            <span className="tb-logo-text">Thumbnail Battle</span>
          </div>
          
          <div className="tb-game-metrics">
            <div className="tb-metric">
              <span className="tb-metric-label">Accuracy</span>
              <span className="tb-metric-value">{accuracy}%</span>
            </div>
            <div className="tb-metric tb-metric-best">
              <span className="tb-metric-label">Best</span>
              <span className="tb-metric-value">{highScore}</span>
            </div>
            <div className="tb-metric tb-metric-streak">
              <span className="tb-metric-label">Streak</span>
              <span className="tb-metric-value">
                {streak}
                {streak >= 5 && ' 🔥'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <main className="tb-game-main">
        <header>
          <motion.h1 
            className="tb-game-title"
            key={`round-${totalGames}`}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            Which video performed better?
          </motion.h1>
          <p className="tb-game-subtitle">
            Choose the thumbnail that exceeded the channel's average performance
          </p>
        </header>

        <div className="tb-battle-grid">
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

        {/* Action area */}
        <AnimatePresence>
          {gameState === 'revealed' && isCorrect && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <button className="tb-next-button" onClick={handleNext}>
                Next Round
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Keyboard hints */}
      <div className="tb-keyboard-hints">
        <div className="tb-key-indicator">
          <kbd className="tb-key-badge">←</kbd>
          <span>Select left</span>
        </div>
        <div className="tb-key-indicator">
          <kbd className="tb-key-badge">→</kbd>
          <span>Select right</span>
        </div>
        {gameState === 'revealed' && isCorrect && (
          <div className="tb-key-indicator">
            <kbd className="tb-key-badge">Enter</kbd>
            <span>Next round</span>
          </div>
        )}
      </div>
    </div>
  );
}
'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import './styles.css';

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

export default function ThumbnailBattleRedesigned() {
  const [battle, setBattle] = useState<Battle | null>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
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
    
    if (saved) setBestStreak(parseInt(saved));
    if (games) setTotalGames(parseInt(games));
    if (correct) setCorrectPicks(parseInt(correct));
    
    loadNewBattle();

    // Keyboard shortcuts
    const handleKeyPress = (e: KeyboardEvent) => {
      if (gameState === 'playing') {
        if (e.key.toLowerCase() === 'a') handleSelection('A');
        if (e.key.toLowerCase() === 'b') handleSelection('B');
      }
      if (gameState === 'revealed' && isCorrect && e.key === 'Enter') {
        handleNext();
      }
      if (gameState === 'gameOver' && e.key === 'Enter') {
        handleRestart();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [gameState, isCorrect]);

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

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  };

  const handleSelection = useCallback((selection: 'A' | 'B') => {
    if (gameState !== 'playing' || !battle) return;

    setSelectedVideo(selection);
    
    const winner = battle.videoA.temporal_performance_score > battle.videoB.temporal_performance_score ? 'A' : 'B';
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
      
      if (newStreak % 5 === 0) {
        triggerConfetti();
      }
      
      if (newStreak > bestStreak) {
        setBestStreak(newStreak);
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
  }, [gameState, battle, streak, bestStreak, totalGames, correctPicks]);

  const handleNext = () => {
    if (isCorrect) {
      loadNewBattle();
    }
  };

  const handleRestart = () => {
    setStreak(0);
    loadNewBattle();
  };

  const accuracy = totalGames > 0 ? Math.round((correctPicks / totalGames) * 100) : 0;

  if (loading) {
    return (
      <div className="game-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  if (gameState === 'gameOver') {
    return (
      <div className="game-container">
        <motion.div
          className="game-over-card"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="game-over-icon"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </motion.div>
          
          <h1 className="game-over-title">Game Over</h1>
          <p className="game-over-subtitle">Great effort! Ready for another round?</p>
          
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Final Streak</span>
              <span className="stat-value">{streak}</span>
            </div>
            
            <div className="stat-card highlight">
              <span className="stat-label">Best Streak</span>
              <span className="stat-value">{bestStreak} 🏆</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Accuracy</span>
              <span className="stat-value">{accuracy}%</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Total Games</span>
              <span className="stat-value">{totalGames}</span>
            </div>
          </div>
          
          <button className="play-again-btn" onClick={handleRestart}>
            Play Again
            <span className="key-hint">Enter</span>
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
        className={`battle-card ${showResult && isSelected ? (isCorrect ? 'correct' : 'incorrect') : ''} ${showResult && !isSelected && isWinner ? 'winner' : ''}`}
        onClick={onClick}
        disabled={gameState !== 'playing'}
        whileHover={gameState === 'playing' ? { scale: 1.02 } : {}}
        whileTap={gameState === 'playing' ? { scale: 0.98 } : {}}
        animate={isSelected && showResult ? 
          isCorrect ? { scale: [1, 1.05, 1] } : { x: [0, -10, 10, -10, 10, 0] } 
          : {}
        }
      >
        <div className="option-indicator">{side}</div>
        
        <div className="thumbnail-wrapper">
          <img 
            src={video.thumbnail_url} 
            alt={video.title}
            className="thumbnail"
          />
          
          <AnimatePresence>
            {showResult && (
              <motion.div
                className={`result-overlay ${isSelected ? (isCorrect ? 'correct' : 'incorrect') : isWinner ? 'winner' : 'loser'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {isSelected && (
                  <motion.div
                    className="result-icon"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
                  >
                    {isCorrect ? '✓' : '✗'}
                  </motion.div>
                )}
                
                <motion.div
                  className="result-stats"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="performance-score">
                    {video.temporal_performance_score.toFixed(1)}x
                  </div>
                  <div className="performance-label">
                    channel average
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <h3 className="video-title">
          {video.title}
        </h3>
      </motion.button>
    );
  };

  return (
    <div className="game-container">
      {/* Fixed stats bar */}
      <div className="stats-bar">
        <div className="stats-container">
          <div className="game-logo">
            <span className="logo-icon">🎯</span>
            <span className="logo-text">Thumbnail Battle</span>
          </div>
          
          <div className="game-metrics">
            <div className="metric">
              <span className="metric-label">Accuracy</span>
              <span className="metric-value">{accuracy}%</span>
            </div>
            <div className="metric metric-best">
              <span className="metric-label">Best</span>
              <span className="metric-value">{bestStreak}</span>
            </div>
            <div className="metric metric-streak">
              <span className="metric-label">Streak</span>
              <span className="metric-value">
                {streak}
                {streak >= 5 && ' 🔥'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <main className="game-main">
        <header className="game-header">
          <motion.h1 
            className="game-title"
            key={`round-${totalGames}`}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            Which video performed better?
          </motion.h1>
          <p className="game-subtitle">
            Choose the thumbnail that exceeded the channel's average performance
          </p>
        </header>

        <div className="battle-grid">
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
              className="action-area"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <button className="next-button" onClick={handleNext}>
                Next Round
                <span className="key-hint">Enter</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Keyboard hints */}
      <div className="keyboard-hints">
        <div className="key-indicator">
          <kbd className="key-badge">A</kbd>
          <span>Select left</span>
        </div>
        <div className="key-indicator">
          <kbd className="key-badge">B</kbd>
          <span>Select right</span>
        </div>
        {gameState === 'revealed' && isCorrect && (
          <div className="key-indicator">
            <kbd className="key-badge">Enter</kbd>
            <span>Next round</span>
          </div>
        )}
      </div>
    </div>
  );
}
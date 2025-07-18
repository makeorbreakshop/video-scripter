'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface StreamingStatusProps {
  isActive: boolean;
  concept?: string;
  onStatusUpdate?: (message: string, progress: number, details?: any) => void;
}

interface StatusMessage {
  message: string;
  timestamp: number;
}

export function StreamingStatus({ isActive, concept, onStatusUpdate }: StreamingStatusProps) {
  const [currentMessage, setCurrentMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [details, setDetails] = useState<any>(null);
  const [messageHistory, setMessageHistory] = useState<StatusMessage[]>([]);
  const messageIndexRef = useRef(0);
  
  // Rotate through recent messages every 2 seconds
  useEffect(() => {
    if (!isActive || messageHistory.length === 0) return;
    
    const interval = setInterval(() => {
      const recentMessages = messageHistory.slice(-5); // Keep last 5 messages
      if (recentMessages.length > 0) {
        messageIndexRef.current = (messageIndexRef.current + 1) % recentMessages.length;
        setCurrentMessage(recentMessages[messageIndexRef.current].message);
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isActive, messageHistory]);
  
  useEffect(() => {
    if (!isActive || !concept) {
      setCurrentMessage('');
      setProgress(0);
      setDetails(null);
      setMessageHistory([]);
      messageIndexRef.current = 0;
      return;
    }
    
    // Simulate status updates for now (we'll implement real SSE later)
    const messages = [
      { message: 'Initializing semantic search engine...', progress: 5 },
      { message: 'Generating 12 diverse search angles...', progress: 10 },
      { message: 'Creating 36 search query variations...', progress: 15 },
      { message: 'Converting queries to semantic vectors...', progress: 20 },
      { message: `Searching through ${(134139).toLocaleString()} YouTube titles...`, progress: 30 },
      { message: 'Finding semantically similar videos...', progress: 35 },
      { message: 'Filtering by performance metrics (3x+ baseline)...', progress: 40 },
      { message: 'Deduplicating results across threads...', progress: 45 },
      { message: 'Running DBSCAN clustering algorithm...', progress: 50 },
      { message: 'Identifying cross-thread patterns...', progress: 55 },
      { message: 'Scoring cluster quality...', progress: 60 },
      { message: 'Analyzing viral title structures...', progress: 70 },
      { message: 'Extracting high-performing patterns...', progress: 80 },
      { message: 'Generating personalized suggestions...', progress: 90 },
      { message: 'Finalizing results...', progress: 95 }
    ];
    
    let currentIndex = 0;
    const simulationInterval = setInterval(() => {
      if (currentIndex < messages.length) {
        const msg = messages[currentIndex];
        setCurrentMessage(msg.message);
        setProgress(msg.progress);
        setMessageHistory(prev => [...prev, { 
          message: msg.message, 
          timestamp: Date.now() 
        }]);
        
        if (onStatusUpdate) {
          onStatusUpdate(msg.message, msg.progress);
        }
        
        currentIndex++;
      } else {
        clearInterval(simulationInterval);
      }
    }, 2500);
    
    return () => clearInterval(simulationInterval);
  }, [isActive, concept, onStatusUpdate]);
  
  if (!isActive) return null;
  
  return (
    <div className="w-full max-w-2xl mx-auto mb-6">
      <div className="relative">
        {/* Progress bar background */}
        <div className="absolute inset-0 bg-gray-800 rounded-full h-12 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-600 to-purple-600 opacity-20"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        
        {/* Content */}
        <div className="relative flex items-center gap-3 h-12 px-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-4 h-4 text-blue-400" />
          </motion.div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={currentMessage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex items-center justify-between"
            >
              <p className="text-sm text-gray-300 font-medium">
                {currentMessage || 'Initializing...'}
              </p>
              
              {details && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-xs text-blue-400 font-mono"
                >
                  {details.queryCount && `${details.queryCount} queries`}
                  {details.totalVideos && `${details.totalVideos.toLocaleString()} videos`}
                  {details.patterns && `${details.patterns} patterns`}
                </motion.span>
              )}
            </motion.div>
          </AnimatePresence>
          
          <span className="text-xs text-gray-500 font-mono">
            {progress}%
          </span>
        </div>
      </div>
      
      {/* Additional info tooltip */}
      {details && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-2 px-4 py-2 bg-gray-800/50 rounded text-xs text-gray-400"
        >
          <div className="flex gap-4">
            {Object.entries(details).map(([key, value]) => (
              <span key={key}>
                <span className="text-gray-500">{key}:</span>{' '}
                <span className="text-gray-300">{value}</span>
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
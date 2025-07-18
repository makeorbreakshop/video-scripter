'use client';

import { motion } from 'framer-motion';

export function ResultsShimmer() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: index * 0.1 }}
          className="relative overflow-hidden"
        >
          <div className="border border-gray-700 bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              {/* Left: Title and Pattern */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  {/* Performance Badge Skeleton */}
                  <div className="w-[60px] h-6 bg-gray-700 rounded-full animate-pulse" />
                  
                  {/* Title Skeleton */}
                  <div className="flex-1 h-5 bg-gray-700 rounded animate-pulse" />
                </div>
              </div>

              {/* Right: Action Buttons Skeleton */}
              <div className="flex items-center gap-2 ml-4">
                <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
                <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
              </div>
            </div>

            {/* Shimmer overlay */}
            <motion.div
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-gray-600/10 to-transparent"
              animate={{
                translateX: ['100%', '-100%'],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                repeatDelay: 0.5,
                ease: "linear"
              }}
            />
          </div>
        </motion.div>
      ))}

      {/* Info text */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-sm text-muted-foreground mt-4"
      >
        Discovering patterns from top-performing videos...
      </motion.p>
    </div>
  );
}
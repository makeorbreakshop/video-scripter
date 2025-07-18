'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { motion } from 'framer-motion';
import { 
  Brain, 
  Search, 
  Sparkles, 
  Cpu, 
  Database,
  Layers,
  Zap,
  TrendingUp,
  Lightbulb,
  Target,
  Rocket,
  ChefHat,
  Code,
  Dumbbell,
  GraduationCap,
  Film,
  Hammer,
  Briefcase,
  Heart,
  Plane,
  MoreHorizontal
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface SearchProgressProps {
  isActive: boolean;
  concept?: string;
  currentStep?: string;
  progress?: number;
}

const DOMAIN_ICONS: Record<string, any> = {
  cooking: ChefHat,
  technology: Code,
  fitness: Dumbbell,
  education: GraduationCap,
  entertainment: Film,
  diy: Hammer,
  business: Briefcase,
  health: Heart,
  travel: Plane,
  other: MoreHorizontal
};

const PROGRESS_STEPS = [
  {
    id: 'domain',
    label: 'Analyzing Domain',
    icon: Brain,
    messages: [
      'Detecting search intent...',
      'Understanding your concept...',
      'Identifying domain context...'
    ]
  },
  {
    id: 'expansion',
    label: 'Expanding Queries',
    icon: Layers,
    messages: [
      'Generating search variations...',
      'Exploring different angles...',
      'Building query threads...'
    ]
  },
  {
    id: 'embedding',
    label: 'Creating Embeddings',
    icon: Cpu,
    messages: [
      'Converting to vectors...',
      'Processing semantics...',
      'Encoding concepts...'
    ]
  },
  {
    id: 'search',
    label: 'Searching Database',
    icon: Database,
    messages: [
      'Scanning 122K+ videos...',
      'Finding semantic matches...',
      'Gathering high performers...'
    ]
  },
  {
    id: 'analysis',
    label: 'Discovering Patterns',
    icon: Sparkles,
    messages: [
      'Analyzing top performers...',
      'Identifying viral patterns...',
      'Extracting title templates...'
    ]
  },
  {
    id: 'generation',
    label: 'Generating Titles',
    icon: Lightbulb,
    messages: [
      'Applying discovered patterns...',
      'Crafting title suggestions...',
      'Finalizing recommendations...'
    ]
  }
];

export function SearchProgress({ isActive, concept, currentStep, progress = 0 }: SearchProgressProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [detectedDomain, setDetectedDomain] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setCurrentStepIndex(0);
      setMessageIndex(0);
      setDetectedDomain(null);
      return;
    }

    // Simulate progress through steps
    const stepInterval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < PROGRESS_STEPS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 3000);

    // Rotate messages within each step
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % 3);
    }, 1000);

    // Simulate domain detection
    if (currentStepIndex === 0 && !detectedDomain) {
      setTimeout(() => {
        // Simple domain detection based on keywords
        const lowerConcept = concept?.toLowerCase() || '';
        if (lowerConcept.includes('cook') || lowerConcept.includes('recipe') || lowerConcept.includes('food')) {
          setDetectedDomain('cooking');
        } else if (lowerConcept.includes('code') || lowerConcept.includes('programming') || lowerConcept.includes('python')) {
          setDetectedDomain('technology');
        } else if (lowerConcept.includes('workout') || lowerConcept.includes('exercise') || lowerConcept.includes('fitness')) {
          setDetectedDomain('fitness');
        } else {
          setDetectedDomain('other');
        }
      }, 1500);
    }

    return () => {
      clearInterval(stepInterval);
      clearInterval(messageInterval);
    };
  }, [isActive, currentStepIndex, concept, detectedDomain]);

  if (!isActive) return null;

  const currentStepData = PROGRESS_STEPS[currentStepIndex];
  const CurrentIcon = currentStepData.icon;
  const DomainIcon = detectedDomain ? DOMAIN_ICONS[detectedDomain] : null;
  const progressPercentage = Math.min((currentStepIndex + 1) / PROGRESS_STEPS.length * 100, 100);

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className="bg-card border rounded-lg p-6 space-y-4">
        {/* Main progress indicator */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <CurrentIcon className="w-5 h-5 text-primary" />
            </motion.div>
            <h3 className="font-medium">{currentStepData.label}</h3>
            {detectedDomain && DomainIcon && currentStepIndex > 0 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <DomainIcon className="w-4 h-4" />
                <span>{detectedDomain}</span>
              </motion.div>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            Step {currentStepIndex + 1} of {PROGRESS_STEPS.length}
          </span>
        </div>

        {/* Animated message */}
        <AnimatePresence mode="wait">
          <motion.p
            key={`${currentStepIndex}-${messageIndex}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="text-sm text-muted-foreground"
          >
            {currentStepData.messages[messageIndex]}
          </motion.p>
        </AnimatePresence>

        {/* Progress bar */}
        <Progress value={progressPercentage} className="h-2" />

        {/* Step indicators */}
        <div className="flex justify-between mt-4">
          {PROGRESS_STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStepIndex;
            const isCompleted = index < currentStepIndex;

            return (
              <motion.div
                key={step.id}
                initial={{ scale: 0.8, opacity: 0.5 }}
                animate={{
                  scale: isActive ? 1.1 : isCompleted ? 1 : 0.8,
                  opacity: isActive || isCompleted ? 1 : 0.5
                }}
                transition={{ duration: 0.3 }}
                className="relative"
              >
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    transition-colors duration-300
                    ${isActive ? 'bg-primary text-primary-foreground' : 
                      isCompleted ? 'bg-primary/20 text-primary' : 
                      'bg-muted text-muted-foreground'}
                  `}
                >
                  <StepIcon className="w-5 h-5" />
                </div>
                {isActive && (
                  <motion.div
                    className="absolute -inset-1 rounded-full border-2 border-primary"
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Fun facts or tips */}
        {currentStepIndex === 3 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-muted/50 rounded-md"
          >
            <p className="text-xs text-muted-foreground">
              <Zap className="w-3 h-3 inline mr-1" />
              Searching through {(122259).toLocaleString()} video embeddings at lightning speed!
            </p>
          </motion.div>
        )}

        {currentStepIndex === 4 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-muted/50 rounded-md"
          >
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="w-3 h-3 inline mr-1" />
              Finding patterns from videos with up to 50x channel performance!
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
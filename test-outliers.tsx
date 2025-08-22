'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle, TrendingUp, Database, RefreshCw, Lock, ChevronDown, ChevronUp, X, Sparkles } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export default function OutliersPage() {
  const [showMore, setShowMore] = useState(false);
  const [email, setEmail] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleGetAccess = () => {
    if (!email) {
      document.getElementById('email-input')?.focus();
      return;
    }
    setShowCheckout(true);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-[#00ff00] font-bold drop-shadow-[0_0_10px_rgba(0,255,0,0.5)]';
    if (score >= 80) return 'text-yellow-400 font-semibold';
    return 'text-red-500';
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <h1>Test Page</h1>
      </div>
    </div>
  );
}
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Upload, FileAudio, Brain, Search, Package, ChevronDown, Check,
  AlertCircle, TrendingUp, Lightbulb, CheckCircle, Target, Camera, 
  FileText, Video, PlayCircle, ChevronUp
} from 'lucide-react';

interface MultiDimensionalConcept {
  core_problem: string;
  psychological_need: string;
  status_shift: string;
  semantic_queries: {
    topic_similarity?: string[];
    psychological_similarity?: string[];
    format_similarity?: string[];
  };
}

interface SearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  temporal_performance_score: number;
  search_score: number;
  thumbnail_url: string;
  matching_query: string;
  search_source: string;
}

interface Channel {
  channel_id: string;
  channel_name: string;
  channel_icon?: string;
  video_count: number;
  avg_performance?: number;
  latest_video_date?: string;
}

interface DiscoveredFrame {
  frame_name: string;
  frequency: number;
  confidence_score: number;
  multi_modal_evidence: {
    thumbnail_pattern: string;
    title_pattern: string;
    content_pattern: string;
  };
  example_videos: string[];
  application_to_your_concept: {
    adaptation_strategy: string;
    specific_recommendations: string[];
    confidence: number;
  };
  your_channel_fit: 'proven' | 'untested' | 'gap';
  channel_fit_reasoning?: string;
  recommendation: 'leverage_strength' | 'fill_gap' | 'improve_existing';
  your_proven_examples?: string[];
}

interface FrameAnalysis {
  discovered_frames: DiscoveredFrame[];
  cross_frame_insights: string;
  strategic_summary: string;
}

// Add interface for selected concepts
interface SelectedConcept {
  id: string;
  frameIndex: number;
  frameName: string;
  concept: any;
  context: {
    frame: DiscoveredFrame;
    transcript: string;
    userConcept: MultiDimensionalConcept;
    searchResults: SearchResult[];
  };
  variations?: {
    titles?: Array<{ id: string; text: string; created_at: string; score?: number }>;
    hooks?: Array<{ id: string; text: string; created_at: string; type?: string }>;
    thumbnails?: Array<{ id: string; text_overlay: string; visual_description: string; created_at: string }>;
  };
}

// IterationCard component for the iteration step
const IterationCard = ({ 
  selected, 
  onUpdateVariations 
}: { 
  selected: SelectedConcept;
  onUpdateVariations: (type: 'titles' | 'hooks' | 'thumbnails', newVariations: any[]) => void;
}) => {
  const [generatingType, setGeneratingType] = useState<'titles' | 'hooks' | 'thumbnails' | null>(null);

  const generateVariations = async (type: 'titles' | 'hooks' | 'thumbnails') => {
    setGeneratingType(type);
    
    try {
      const endpoint = `/api/iterate-${type}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept_id: selected.id,
          original_concept: selected.concept,
          frame_context: selected.context.frame,
          user_concept: selected.context.userConcept,
          previous_variations: selected.variations?.[type] || []
        })
      });

      if (!response.ok) throw new Error(`Failed to generate ${type}`);
      
      const data = await response.json();
      onUpdateVariations(type, data.new_variations);
    } catch (error) {
      console.error(`Error generating ${type}:`, error);
    } finally {
      setGeneratingType(null);
    }
  };

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{selected.concept.title}</CardTitle>
            <CardDescription className="mt-1">
              Based on: {selected.frameName} • {selected.concept.why_it_works}
            </CardDescription>
          </div>
          <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/50">
            {Math.round((selected.concept.confidence || 0.8) * 100)}% match
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Titles Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-zinc-300">Titles</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => generateVariations('titles')}
                disabled={generatingType === 'titles'}
                className="text-xs"
              >
                {generatingType === 'titles' ? (
                  <>Generating...</>
                ) : (
                  <>+ Generate More</>
                )}
              </Button>
            </div>
            <div className="space-y-2">
              {/* Original */}
              <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <p className="text-sm text-zinc-300">{selected.concept.title}</p>
                <p className="text-xs text-zinc-500 mt-1">Original</p>
              </div>
              {/* Variations */}
              {selected.variations?.titles?.map((title) => (
                <div key={title.id} className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700 hover:border-zinc-600 cursor-pointer transition-colors">
                  <p className="text-sm text-zinc-300">{title.text}</p>
                  {title.score && (
                    <p className="text-xs text-zinc-500 mt-1">Score: {title.score}/10</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Hooks Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-zinc-300">Hooks</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => generateVariations('hooks')}
                disabled={generatingType === 'hooks'}
                className="text-xs"
              >
                {generatingType === 'hooks' ? (
                  <>Generating...</>
                ) : (
                  <>+ Generate More</>
                )}
              </Button>
            </div>
            <div className="space-y-2">
              {/* Original */}
              <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <p className="text-sm text-zinc-300 italic">"{selected.concept.hook}"</p>
                <p className="text-xs text-zinc-500 mt-1">Original</p>
              </div>
              {/* Variations */}
              {selected.variations?.hooks?.map((hook) => (
                <div key={hook.id} className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700 hover:border-zinc-600 cursor-pointer transition-colors">
                  <p className="text-sm text-zinc-300 italic">"{hook.text}"</p>
                  {hook.type && (
                    <p className="text-xs text-zinc-500 mt-1">{hook.type}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Thumbnails Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-zinc-300">Thumbnails</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => generateVariations('thumbnails')}
                disabled={generatingType === 'thumbnails'}
                className="text-xs"
              >
                {generatingType === 'thumbnails' ? (
                  <>Generating...</>
                ) : (
                  <>+ Generate More</>
                )}
              </Button>
            </div>
            <div className="space-y-2">
              {/* Original */}
              <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                <p className="text-sm text-zinc-300 font-medium">{selected.concept.thumbnail_text}</p>
                <p className="text-xs text-zinc-400 mt-1">{selected.concept.thumbnail_visual}</p>
                <p className="text-xs text-zinc-500 mt-1">Original</p>
              </div>
              {/* Variations */}
              {selected.variations?.thumbnails?.map((thumb) => (
                <div key={thumb.id} className="p-3 bg-zinc-800/30 rounded-lg border border-zinc-700 hover:border-zinc-600 cursor-pointer transition-colors">
                  <p className="text-sm text-zinc-300 font-medium">{thumb.text_overlay}</p>
                  <p className="text-xs text-zinc-400 mt-1">{thumb.visual_description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function ConceptPackagePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [conceptJson, setConceptJson] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [frameAnalysis, setFrameAnalysis] = useState<FrameAnalysis | null>(null);
  const [frameAnalysisMeta, setFrameAnalysisMeta] = useState<any>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [channelSearchResults, setChannelSearchResults] = useState<Channel[]>([]);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [generatingForFrame, setGeneratingForFrame] = useState<number | null>(null);
  const [generatedConceptsPerFrame, setGeneratedConceptsPerFrame] = useState<{[key: number]: any}>({});
  const [selectedConcepts, setSelectedConcepts] = useState<SelectedConcept[]>([]);
  const channelDropdownRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Cache keys for localStorage
  const CACHE_KEYS = {
    conceptJson: 'concept-package-json',
    searchResults: 'concept-package-search-results',
    frameAnalysis: 'concept-package-frame-analysis',
    frameAnalysisMeta: 'concept-package-frame-analysis-meta',
    selectedChannel: 'concept-package-selected-channel',
    transcript: 'concept-package-transcript',
    generatedConcepts: 'concept-package-generated-concepts',
    selectedConcepts: 'concept-package-selected-concepts'
  };

  // Auto-select frame on scroll
  useEffect(() => {
    if (!frameAnalysis) return;
    
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200; // Offset for better detection
      
      frameRefs.current.forEach((ref, index) => {
        if (ref) {
          const { top, bottom } = ref.getBoundingClientRect();
          const absoluteTop = top + window.scrollY;
          const absoluteBottom = bottom + window.scrollY;
          
          if (scrollPosition >= absoluteTop && scrollPosition < absoluteBottom) {
            setSelectedFrameIndex(index);
          }
        }
      });
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [frameAnalysis]);

  // Load cached data on component mount
  useEffect(() => {
    const loadCachedData = () => {
      if (typeof window === 'undefined') return;
      
      try {
        let maxStep = 1;
        
        // Load transcript
        const cachedTranscript = localStorage.getItem(CACHE_KEYS.transcript);
        if (cachedTranscript) {
          setTranscript(cachedTranscript);
          if (cachedTranscript.length > 0) {
            maxStep = Math.max(maxStep, 2);
          }
        }
        
        // Load concept JSON
        const cachedJson = localStorage.getItem(CACHE_KEYS.conceptJson);
        if (cachedJson) {
          setConceptJson(cachedJson);
          const parsed = JSON.parse(cachedJson);
          if (parsed && Object.keys(parsed).length > 0) {
            maxStep = Math.max(maxStep, 3);
          }
        }

        // Load search results
        const cachedResults = localStorage.getItem(CACHE_KEYS.searchResults);
        if (cachedResults) {
          const results = JSON.parse(cachedResults);
          setSearchResults(results);
          if (results.length > 0) {
            maxStep = Math.max(maxStep, 4);
          }
        }

        // Load frame analysis
        const cachedFrames = localStorage.getItem(CACHE_KEYS.frameAnalysis);
        if (cachedFrames) {
          const frames = JSON.parse(cachedFrames);
          setFrameAnalysis(frames);
          if (frames && frames.discovered_frames) {
            maxStep = Math.max(maxStep, 5);
          }
        }
        
        // Load frame analysis metadata
        const cachedFramesMeta = localStorage.getItem(CACHE_KEYS.frameAnalysisMeta);
        if (cachedFramesMeta) {
          const meta = JSON.parse(cachedFramesMeta);
          setFrameAnalysisMeta(meta);
        }
        
        // Load generated concepts per frame
        const cachedConcepts = localStorage.getItem(CACHE_KEYS.generatedConcepts);
        if (cachedConcepts) {
          const concepts = JSON.parse(cachedConcepts);
          setGeneratedConceptsPerFrame(concepts);
        }

        // Load selected channel
        const cachedChannel = localStorage.getItem(CACHE_KEYS.selectedChannel);
        if (cachedChannel) {
          const channel = JSON.parse(cachedChannel);
          setSelectedChannel(channel);
          setChannelSearchQuery(channel.channel_name);
        }
        
        // Set the step to the highest completed step
        setCurrentStep(maxStep);
        console.log('Loaded cached data, setting step to:', maxStep);
      } catch (error) {
        console.error('Error loading cached data:', error);
      }
    };

    loadCachedData();
  }, []);

  // Save data to cache whenever it changes
  useEffect(() => {
    if (conceptJson) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.conceptJson, conceptJson);
    }
  }, [conceptJson]);

  useEffect(() => {
    if (searchResults.length > 0) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.searchResults, JSON.stringify(searchResults));
    }
  }, [searchResults]);

  useEffect(() => {
    if (frameAnalysis) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.frameAnalysis, JSON.stringify(frameAnalysis));
    }
  }, [frameAnalysis]);

  useEffect(() => {
    if (selectedChannel) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.selectedChannel, JSON.stringify(selectedChannel));
    }
  }, [selectedChannel]);

  useEffect(() => {
    if (transcript) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.transcript, transcript);
    }
  }, [transcript]);
  
  useEffect(() => {
    if (frameAnalysisMeta) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.frameAnalysisMeta, JSON.stringify(frameAnalysisMeta));
    }
  }, [frameAnalysisMeta]);
  
  useEffect(() => {
    if (Object.keys(generatedConceptsPerFrame).length > 0) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.generatedConcepts, JSON.stringify(generatedConceptsPerFrame));
    }
  }, [generatedConceptsPerFrame]);

  useEffect(() => {
    if (selectedConcepts.length > 0) {
      typeof window !== "undefined" && localStorage.setItem(CACHE_KEYS.selectedConcepts, JSON.stringify(selectedConcepts));
    }
  }, [selectedConcepts]);

  // Clear cache function
  const clearCache = () => {
    const hasData = conceptJson || searchResults.length > 0 || frameAnalysis || transcript;
    
    if (hasData) {
      const confirmed = window.confirm(
        'This will clear all your cached data including:\n' +
        (conceptJson ? '• Concept JSON\n' : '') +
        (searchResults.length > 0 ? '• Search Results\n' : '') +
        (frameAnalysis ? '• Frame Analysis\n' : '') +
        (transcript ? '• Transcript\n' : '') +
        '\nAre you sure you want to restart?'
      );
      
      if (!confirmed) return;
    }
    
    Object.values(CACHE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    
    // Reset all state
    setCurrentStep(1);
    setTranscript('');
    setConceptJson('');
    setSearchResults([]);
    setFrameAnalysis(null);
    setFrameAnalysisMeta(null);
    setGeneratedConceptsPerFrame({});
    setSelectedConcepts([]);
    setSelectedChannel(null);
    setChannelSearchQuery('');
    setChannelSearchResults([]);
    setUploadProgress(0);
    setProgressMessage('');
    setShowChannelDropdown(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(event.target as Node)) {
        setShowChannelDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const steps = [
    { number: 1, title: 'Upload MP3', icon: Upload, description: 'Upload your audio file' },
    { number: 2, title: 'Transcribe', icon: FileAudio, description: 'Convert audio to text' },
    { number: 3, title: 'Extract Concept', icon: Brain, description: 'Analyze content concept' },
    { number: 4, title: 'Find Outliers', icon: Search, description: 'Search matching videos' },
    { number: 5, title: 'Extract Frames', icon: Package, description: 'Discover successful patterns' },
    { number: 6, title: 'Iterate', icon: Lightbulb, description: 'Refine titles & thumbnails' }
  ];

  // File upload and compression
  const compressAudio = async (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const fileReader = new FileReader();
      
      fileReader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Create offline context for compression
          const offlineContext = new OfflineAudioContext(
            1, // Mono
            audioBuffer.duration * 16000, // 16kHz sample rate
            16000
          );
          
          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start(0);
          
          const compressedBuffer = await offlineContext.startRendering();
          
          // Convert to WAV blob
          const wavBlob = audioBufferToWav(compressedBuffer);
          const compressedFile = new File([wavBlob], file.name.replace(/\.[^/.]+$/, '.wav'), {
            type: 'audio/wav'
          });
          
          resolve(compressedFile);
        } catch (error) {
          console.error('Audio compression failed:', error);
          resolve(file); // Fallback to original file
        }
      };
      
      fileReader.onerror = () => reject(new Error('Failed to read file'));
      fileReader.readAsArrayBuffer(file);
    });
  };

  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setUploadProgress(0);
    setProgressMessage('Preparing audio file...');

    try {
      // Compress if file is too large
      let processedFile = file;
      if (file.size > 25 * 1024 * 1024) {
        setProgressMessage('Compressing large audio file...');
        setUploadProgress(20);
        processedFile = await compressAudio(file);
      }

      const formData = new FormData();
      formData.append('audio', processedFile);

      setUploadProgress(40);
      const progressMessages = [
        'Uploading audio file...',
        'Starting transcription...',
        'Processing audio with Whisper AI...',
        'Converting speech to text...',
        'Finalizing transcript...'
      ];
      
      let messageIndex = 0;
      setProgressMessage(progressMessages[0]);
      
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 90));
        if (messageIndex < progressMessages.length - 1) {
          messageIndex++;
          setProgressMessage(progressMessages[messageIndex]);
        }
      }, 8000);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Transcription failed');
      }

      const data = await response.json();
      setTranscript(data.transcript);
      setCurrentStep(2);
      
    } catch (error: any) {
      console.error('Upload error:', error);
      alert(error.message || 'Failed to process audio file');
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      setProgressMessage('');
    }
  };

  const searchChannels = async (query: string) => {
    if (query.length < 2) {
      setChannelSearchResults([]);
      return;
    }

    try {
      const response = await fetch(`/api/search-channels?q=${encodeURIComponent(query)}&limit=10`);
      if (!response.ok) throw new Error('Channel search failed');
      
      const data = await response.json();
      setChannelSearchResults(data.channels || []);
    } catch (error) {
      console.error('Channel search error:', error);
      setChannelSearchResults([]);
    }
  };

  const handleChannelSelect = (channel: Channel) => {
    setSelectedChannel(channel);
    setChannelSearchQuery(channel.channel_name);
    setShowChannelDropdown(false);
  };

  const searchForVideos = async () => {
    if (!conceptJson.trim()) {
      alert('Please enter your multi-dimensional concept JSON first.');
      return;
    }

    let concept: MultiDimensionalConcept;
    try {
      concept = JSON.parse(conceptJson);
      if (!concept.semantic_queries) {
        throw new Error('Missing semantic_queries in JSON');
      }
    } catch (error) {
      alert('Invalid JSON format. Please check your concept JSON.');
      return;
    }

    setIsProcessing(true);
    setProgressMessage('Searching for outlier videos across multiple dimensions...');

    try {
      const response = await fetch('/api/concept-search-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semantic_queries: [],
          multi_dimensional_queries: concept.semantic_queries,
          min_performance_ratio: 1.5,
          limit: 30,
          min_score: 0.3
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Search failed');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
      setCurrentStep(4);

    } catch (error: any) {
      console.error('Search error:', error);
      alert(error.message || 'Failed to search for videos');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  };

  const generateFrameAnalysis = async () => {
    if (searchResults.length === 0) {
      alert('No search results available for frame analysis.');
      return;
    }

    let userConcept;
    try {
      const parsed = JSON.parse(conceptJson);
      userConcept = {
        core_problem: parsed.core_problem,
        psychological_need: parsed.psychological_need, 
        status_shift: parsed.status_shift
      };
    } catch (error) {
      alert('Please ensure your concept JSON is properly formatted.');
      return;
    }

    setIsProcessing(true);
    setProgressMessage('Analyzing patterns across all videos using Claude Sonnet 4...');

    try {
      const response = await fetch('/api/extract-frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          search_results: searchResults,
          user_concept: userConcept,
          user_channel_id: selectedChannel?.channel_id || null
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Frame analysis failed');
      }

      const data = await response.json();
      setFrameAnalysis(data.frame_analysis);
      setFrameAnalysisMeta(data.analysis_meta); // Save the channel analysis metadata
      setCurrentStep(5);

    } catch (error: any) {
      console.error('Frame analysis error:', error);
      alert(error.message || 'Failed to analyze video frames');
    } finally {
      setIsProcessing(false);
      setProgressMessage('');
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center gap-3">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = step.number === currentStep;
        const isComplete = step.number < currentStep;
        
        // Determine if step is accessible based on what data we have
        const isClickable = (() => {
          switch(step.number) {
            case 1: return true; // Always can go back to upload
            case 2: return true; // Always can access transcript step
            case 3: return transcript && transcript.length > 0; // Need transcript
            case 4: return conceptJson && conceptJson.length > 0; // Need concept
            case 5: return searchResults.length > 0; // Need search results
            default: return false;
          }
        })();
        
        return (
          <React.Fragment key={step.number}>
            <button
              onClick={() => isClickable && setCurrentStep(step.number)}
              disabled={!isClickable}
              className={`
                flex items-center gap-1.5 text-xs transition-colors
                ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed'}
                ${isActive 
                  ? 'text-zinc-100' 
                  : isComplete 
                    ? 'text-zinc-400 hover:text-zinc-300' 
                    : 'text-zinc-600'
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{step.title}</span>
              {isComplete && <Check className="w-3 h-3" />}
            </button>
            {index < steps.length - 1 && (
              <div className={`w-4 h-px ${
                isComplete ? 'bg-zinc-600' : 'bg-zinc-800'
              }`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  const renderUploadStep = () => (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Audio or Enter Transcript
          </CardTitle>
          <CardDescription>
            Upload your audio file or paste an existing transcript
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isProcessing ? (
            <div className="space-y-6">
              {/* Upload Audio Option */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-foreground">Option 1: Upload Audio File</div>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="audio-upload"
                  />
                  <label htmlFor="audio-upload" className="cursor-pointer">
                    <FileAudio className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <div className="text-lg font-medium text-foreground mb-2">
                      Click to upload audio file
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Supports MP3, WAV, M4A and other audio formats
                    </div>
                  </label>
                </div>
                <div className="text-xs text-muted-foreground text-center">
                  Files larger than 25MB will be automatically compressed for faster processing.
                </div>
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              {/* Paste Transcript Option */}
              <div className="space-y-4">
                <div className="text-sm font-medium text-foreground">Option 2: Paste Existing Transcript</div>
                <textarea
                  placeholder="Paste your transcript here..."
                  className="w-full h-32 p-4 border rounded-lg bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
                <Button 
                  onClick={() => {
                    if (transcript.trim()) {
                      setCurrentStep(2);
                    }
                  }}
                  disabled={!transcript.trim()}
                  className="w-full"
                >
                  Continue with Transcript
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Progress value={uploadProgress} className="w-full" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{progressMessage}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This may take 1-3 minutes depending on file size...
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderTranscriptStep = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileAudio className="w-5 h-5" />
            Audio Transcript
          </CardTitle>
          <CardDescription>
            {transcript ? 'Your transcript is ready. Review and continue to concept extraction.' : 'Enter or paste your transcript to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {transcript ? (
              <>
                <div className="max-h-60 overflow-y-auto p-4 bg-muted/30 rounded-lg border">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {transcript}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTranscript('')}
                  className="w-full"
                >
                  Edit Transcript
                </Button>
              </>
            ) : (
              <>
                <textarea
                  placeholder="Paste your transcript here..."
                  className="w-full h-48 p-4 border rounded-lg bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  autoFocus
                />
                <div className="text-xs text-muted-foreground">
                  Enter the transcript of your video idea or concept that you want to transform into YouTube videos.
                </div>
              </>
            )}
            
            <div className="flex justify-center">
              <Button 
                onClick={() => setCurrentStep(3)}
                className="px-8 py-2"
                disabled={!transcript || transcript.trim().length === 0}
              >
                <Brain className="w-4 h-4 mr-2" />
                Continue to Concept Extraction
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderConceptStep = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Multi-Dimensional Concept Input
          </CardTitle>
          <CardDescription>
            Paste your structured concept analysis from Anthropic Claude to enable multi-dimensional search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Concept JSON from Anthropic Analysis
            </label>
            <textarea
              value={conceptJson}
              onChange={(e) => setConceptJson(e.target.value)}
              className="w-full h-64 p-3 border border-input rounded-md focus:ring-2 focus:ring-ring focus:border-transparent font-mono text-sm bg-background"
              placeholder={`Paste your multi-dimensional analysis JSON from Anthropic, e.g.:
{
  "core_problem": "Feeling behind or overwhelmed by complex skills that seem impossible to master",
  "psychological_need": "Desire to believe that with the right approach, any skill is achievable", 
  "status_shift": "From someone who gives up on 'impossible' skills to someone who sees achievable mastery",
  "semantic_queries": {
    "topic_similarity": ["drawing perfect circles by hand", "precision hand drawing techniques"],
    "psychological_similarity": ["overcoming impossibility mindset", "skill mastery motivation content"],
    "format_similarity": ["skill demonstration videos", "precision challenge content"]
  }
}`}
            />
          </div>

          {conceptJson && (
            <div className="p-4 bg-primary/5 rounded-lg border-l-4 border-primary">
              <h4 className="font-medium text-primary mb-2">Concept Overview</h4>
              <div className="space-y-2 text-sm">
                {(() => {
                  try {
                    const parsed = JSON.parse(conceptJson);
                    return (
                      <>
                        <p><strong>Core Problem:</strong> <span className="text-primary">{parsed.core_problem}</span></p>
                        <p><strong>Psychological Need:</strong> <span className="text-primary">{parsed.psychological_need}</span></p>
                        <p><strong>Status Shift:</strong> <span className="text-primary">{parsed.status_shift}</span></p>
                        
                        {parsed.semantic_queries && (
                          <div className="mt-3">
                            <p className="font-medium text-primary mb-1">Search Dimensions:</p>
                            <div className="space-y-2">
                              {parsed.semantic_queries.topic_similarity && (
                                <div>
                                  <Badge variant="default" className="text-xs">Topic Similarity</Badge>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {parsed.semantic_queries.topic_similarity.map((query: string, index: number) => (
                                      <Badge key={`topic-${index}`} variant="outline" className="text-sm">
                                        {query}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {parsed.semantic_queries.psychological_similarity && (
                                <div>
                                  <Badge variant="secondary" className="text-xs">Psychological Similarity</Badge>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {parsed.semantic_queries.psychological_similarity.map((query: string, index: number) => (
                                      <Badge key={`psychology-${index}`} variant="outline" className="text-sm">
                                        {query}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {parsed.semantic_queries.format_similarity && (
                                <div>
                                  <Badge variant="secondary" className="text-xs">Format Similarity</Badge>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {parsed.semantic_queries.format_similarity.map((query: string, index: number) => (
                                      <Badge key={`format-${index}`} variant="outline" className="text-sm">
                                        {query}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  } catch (error) {
                    return <p className="text-red-600">Invalid JSON format</p>;
                  }
                })()}
              </div>
            </div>
          )}

          {/* Channel Selection */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Your Channel (Optional but Recommended)
              </label>
              <div className="relative" ref={channelDropdownRef}>
                <div className="relative">
                  <input
                    type="text"
                    value={channelSearchQuery}
                    onChange={(e) => {
                      setChannelSearchQuery(e.target.value);
                      searchChannels(e.target.value);
                      setShowChannelDropdown(true);
                    }}
                    onFocus={() => setShowChannelDropdown(true)}
                    placeholder="Search for your channel..."
                    className="w-full p-3 border border-input rounded-md focus:ring-2 focus:ring-ring focus:border-transparent pr-10 bg-background"
                  />
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                
                {showChannelDropdown && channelSearchResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {channelSearchResults.map((channel) => (
                      <div
                        key={channel.channel_id}
                        onClick={() => handleChannelSelect(channel)}
                        className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer border-b border-border last:border-b-0"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{channel.channel_name}</div>
                          <div className="text-sm text-muted-foreground">
                            Channel
                          </div>
                        </div>
                        {selectedChannel?.channel_id === channel.channel_id && (
                          <Check className="w-4 h-4 text-green-600" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {selectedChannel && (
                <div className="mt-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="font-medium text-green-700 dark:text-green-600">Selected: {selectedChannel.channel_name}</span>
                  </div>
                  <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                    Will analyze your channel's videos to identify proven vs gap frames
                  </p>
                </div>
              )}
              
              <p className="text-xs text-muted-foreground mt-1">
                Selecting your channel enables strategic frame recommendations (proven strengths vs content gaps)
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Button 
              onClick={searchForVideos}
              variant="default"
              className="px-8 py-2"
              disabled={!conceptJson.trim() || isProcessing}
            >
              <Search className="w-4 h-4 mr-2" />
              {isProcessing ? 'Searching...' : 'Search for Outlier Videos'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSearchStep = () => (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header with Channel Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Search className="w-6 h-6" />
                Multi-Dimensional Search Results
              </CardTitle>
              <CardDescription className="text-lg mt-2">
                Found {searchResults.length} high-performing videos across multiple search dimensions
              </CardDescription>
            </div>
            <div className="flex items-center gap-4">
              {selectedChannel && (
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Your Channel</div>
                  <div className="font-semibold">{selectedChannel.channel_name}</div>
                  <div className="text-sm text-muted-foreground">Selected</div>
                </div>
              )}
              <Button
                onClick={() => {
                  localStorage.removeItem(CACHE_KEYS.searchResults);
                  localStorage.removeItem(CACHE_KEYS.frameAnalysis);
                  setSearchResults([]);
                  setFrameAnalysis(null);
                  setCurrentStep(3);
                }}
                variant="outline"
                size="sm"
              >
                🔍 New Search
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {searchResults.map((video) => {
            const getSourceVariant = (source: string): "secondary" | "outline" | "default" => {
              switch (source) {
                case 'topic': return 'default';
                case 'psychology': return 'secondary';
                case 'format': return 'outline';
                case 'channel': return 'secondary';
                default: return 'outline';
              }
            };

            return (
              <Card key={video.video_id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  {/* Thumbnail */}
                  <div className="aspect-video mb-3">
                    <img 
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="w-full h-full object-cover rounded-md"
                    />
                  </div>
                  
                  {/* Title */}
                  <h3 className="font-medium text-sm leading-snug mb-2 line-clamp-2">
                    {video.title}
                  </h3>
                  
                  {/* Channel */}
                  <p className="text-sm text-muted-foreground mb-2">
                    {video.channel_name}
                  </p>
                  
                  {/* Performance Metrics */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold">
                        {video.temporal_performance_score.toFixed(1)}x
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {Math.round((video.search_score || 0) * 100)}% match
                      </span>
                    </div>
                  </div>
                  
                  {/* Source Badge */}
                  <div className="flex items-center justify-between">
                    <Badge variant={getSourceVariant(video.search_source)}>
                      {video.search_source}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {video.view_count.toLocaleString()} views
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <div className="text-muted-foreground">
              No videos found. Try adjusting your search criteria.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extract Frames Button */}
      {searchResults.length > 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <div className="space-y-4">
              <div className="text-lg font-semibold text-foreground">
                Ready to Extract Patterns
              </div>
              <div className="text-muted-foreground max-w-2xl mx-auto">
                Analyze all {searchResults.length} videos to discover recurring successful patterns across multiple dimensions
                {selectedChannel && (
                  <span className="block mt-2 text-emerald-600 dark:text-emerald-500 font-medium">
                    + Your channel analysis for strategic recommendations
                  </span>
                )}
              </div>
              <Button 
                onClick={generateFrameAnalysis}
                variant="default"
                className="px-8 py-3 text-lg"
                disabled={isProcessing}
              >
                <Package className="w-5 h-5 mr-2" />
                Extract Frames from All Videos
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderFrameAnalysisStep = () => {
    // No frame analysis yet - show empty state
    if (!frameAnalysis) {
      return (
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Extract Frames from Videos
              </CardTitle>
              <CardDescription>
                Analyze all search results to discover recurring successful patterns
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                {isProcessing ? (
                  <div className="space-y-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                    <p className="text-muted-foreground">{progressMessage}</p>
                    <p className="text-sm text-muted-foreground">This may take 60-90 seconds...</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Go back and search for videos, then return here to extract patterns.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Helper function to generate concepts for a specific frame
    const generateConceptsForFrame = async (frameIndex: number) => {
      const frame = frameAnalysis.discovered_frames[frameIndex];
      if (!frame) return;
      
      setGeneratingForFrame(frameIndex);
      
      try {
        // Get thumbnail URLs for videos that match this frame
        const matchingVideos = searchResults.filter(video => 
          frame.example_videos.some(exampleTitle => 
            video.title.toLowerCase().includes(exampleTitle.toLowerCase().substring(0, 20))
          )
        ).slice(0, 3); // Get up to 3 matching thumbnails
        
        const response = await fetch('/api/generate-frame-concepts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frame: frame,
            frame_index: frameIndex,
            user_concept: conceptJson ? JSON.parse(conceptJson) : {
              core_problem: 'Master professional skills',
              psychological_need: 'Competence and confidence', 
              status_shift: 'Amateur to professional'
            },
            transcript: transcript, // Original transcript for context
            user_channel: selectedChannel ? {
              channel_id: selectedChannel.channel_id,
              channel_name: selectedChannel.channel_name,
              has_analysis: frameAnalysisMeta?.user_channel_included || false
            } : null,
            all_frames_summary: frameAnalysis.strategic_summary, // Overall strategy context
            example_thumbnails: matchingVideos.map(v => ({
              title: v.title,
              thumbnail_url: v.thumbnail_url,
              view_count: v.view_count,
              performance_score: v.temporal_performance_score
            })) // Visual examples for pattern matching
          })
        });
        
        if (!response.ok) throw new Error('Failed to generate concepts');
        
        const data = await response.json();
        if (data.success && data.concepts) {
          setGeneratedConceptsPerFrame(prev => ({
            ...prev,
            [frameIndex]: data.concepts
          }));
        }
      } catch (error) {
        console.error('Failed to generate concepts:', error);
        alert('Failed to generate concepts for this frame');
      } finally {
        setGeneratingForFrame(null);
      }
    };

    // Show generated outputs view if requested
    if (false) {
      return (
        <div className="w-full max-w-[1600px] mx-auto px-8 py-6">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => setShowGeneratedOutputs(false)}
              className="mb-4 text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-2"
            >
              ← Back to Patterns
            </button>
            <h2 className="text-xl font-normal text-zinc-100">
              Generated Video Concepts
            </h2>
            <p className="text-sm text-zinc-500 mt-2">
              {generatedConcepts.reduce((acc: number, c: any) => acc + c.concepts.length, 0)} video ideas from {frameAnalysis.discovered_frames.length} patterns
            </p>
          </div>

          {/* Generated Concepts Grid */}
          <div className="space-y-12">
            {generatedConcepts.map((conceptGroup: any, groupIndex: number) => (
              <div key={groupIndex}>
                <h3 className="text-lg font-medium text-zinc-100 mb-6">
                  {conceptGroup.pattern_name} Concepts
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {conceptGroup.concepts.map((concept: any, conceptIndex: number) => (
                    <div
                      key={conceptIndex}
                      className="p-6 bg-zinc-800/20 border border-zinc-700 rounded-xl hover:bg-zinc-800/30 transition-all"
                    >
                      <div className="mb-4">
                        <h4 className="text-base font-medium text-zinc-100 mb-2">
                          {concept.title}
                        </h4>
                        <div className="text-sm text-zinc-400 mb-3">
                          Confidence: {Math.round((concept.estimated_performance?.confidence || 0.8) * 100)}%
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs text-zinc-500 uppercase mb-2">Thumbnail Strategy</p>
                          <div className="text-sm text-zinc-300 space-y-1">
                            <p>{concept.thumbnail?.visual_approach}</p>
                            {concept.thumbnail?.text_overlay && (
                              <p className="font-medium">Text: "{concept.thumbnail.text_overlay}"</p>
                            )}
                            {concept.thumbnail?.color_scheme && (
                              <p className="text-xs text-zinc-400">Colors: {concept.thumbnail.color_scheme}</p>
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <p className="text-xs text-zinc-500 uppercase mb-2">Opening Hook</p>
                          <p className="text-sm text-zinc-300 italic">"{concept.hook}"</p>
                        </div>

                        {concept.production_notes && (
                          <div>
                            <p className="text-xs text-zinc-500 uppercase mb-2">Production Notes</p>
                            <p className="text-sm text-zinc-400">{concept.production_notes}</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-6 flex gap-2">
                        <button 
                          className="flex-1 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-sm rounded-lg transition-colors"
                          onClick={() => navigator.clipboard.writeText(concept.title)}
                        >
                          Copy Title
                        </button>
                        <button className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-sm rounded-lg transition-colors">
                          Create Script
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Frame analysis results - Magazine layout with cleaner styling
    return (
      <div className="w-full max-w-[1600px] mx-auto px-8 py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-normal text-zinc-100">
                {frameAnalysis.discovered_frames.length} Patterns Discovered
              </h2>
              <p className="text-sm text-zinc-500 mt-2">
                From {searchResults.length} high-performing videos
              </p>
            </div>
          </div>
          
          {/* Strategic Summary */}
          {frameAnalysis.strategic_summary && (
            <div className="mt-6 p-5 border-l-2 border-zinc-700 bg-zinc-800/20 rounded-r-lg">
              <p className="text-sm text-zinc-400 leading-relaxed">
                {frameAnalysis.strategic_summary}
              </p>
            </div>
          )}
        </div>

        {/* Magazine Layout - Left sidebar + Right content */}
        <div className="flex gap-10">
          {/* Left Sidebar - Frame Navigator */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-8 space-y-3">
              {frameAnalysis.discovered_frames.map((frame, index) => {
                const isActive = selectedFrameIndex === index;
                
                return (
                  <button
                    key={index}
                    onClick={() => {
                      setSelectedFrameIndex(index);
                      document.getElementById(`frame-${index}`)?.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                      });
                    }}
                    className={`w-full text-left p-5 rounded-lg transition-all ${
                      isActive ? 'bg-zinc-800/40 border border-zinc-700' : 'hover:bg-zinc-800/20 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl font-light text-zinc-600">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-zinc-100 mb-2">
                          {frame.frame_name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <span>{Math.round(frame.confidence_score * 100)}% match</span>
                          <span>•</span>
                          <span>{frame.frequency} videos</span>
                          <span>•</span>
                          <span className={`${
                            frame.your_channel_fit === 'proven' ? 'text-blue-400' :
                            frame.your_channel_fit === 'gap' ? 'text-zinc-400' :
                            'text-zinc-500'
                          }`}>
                            {frame.your_channel_fit === 'proven' ? 'Proven' : 
                             frame.your_channel_fit === 'gap' ? 'Opportunity' : 
                             'Untested'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Content - Frame Details */}
          <div className="flex-1 space-y-10 pb-16">
            {frameAnalysis.discovered_frames.map((frame, index) => (
              <div 
                key={index} 
                id={`frame-${index}`}
                ref={(el) => frameRefs.current[index] = el}
                className="scroll-mt-8"
              >
                <FrameCard 
                  frame={frame} 
                  searchResults={searchResults} 
                  frameIndex={index}
                  isActive={selectedFrameIndex === index}
                  generatedConceptsPerFrame={generatedConceptsPerFrame}
                  generatingForFrame={generatingForFrame}
                  generateConceptsForFrame={generateConceptsForFrame}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Clean frame card component
  const FrameCard = ({ 
    frame, 
    searchResults,
    frameIndex,
    isActive,
    generatedConceptsPerFrame,
    generatingForFrame,
    generateConceptsForFrame
  }: { 
    frame: DiscoveredFrame; 
    searchResults: SearchResult[];
    frameIndex: number;
    isActive: boolean;
    generatedConceptsPerFrame: {[key: number]: any};
    generatingForFrame: number | null;
    generateConceptsForFrame: (index: number) => Promise<void>;
  }) => {
    const [showAllRecs, setShowAllRecs] = useState(false);
    const [showConcepts, setShowConcepts] = useState(false);
    const concepts = generatedConceptsPerFrame[frameIndex];
    
    return (
      <div className={`p-8 ${isActive ? 'ring-2 ring-zinc-600 bg-zinc-800/30 shadow-xl' : 'bg-zinc-800/20 ring-1 ring-zinc-700'} rounded-xl transition-all`}>
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-medium text-zinc-100 mb-3">{frame.frame_name}</h3>
              <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span>{Math.round(frame.confidence_score * 100)}% match</span>
            <span>•</span>
            <span>{frame.frequency} videos</span>
            <span>•</span>
            <span className={`${
              frame.your_channel_fit === 'proven' ? 'text-blue-400' :
              frame.your_channel_fit === 'gap' ? 'text-zinc-400' :
              'text-zinc-500'
            }`}>
              {frame.your_channel_fit === 'proven' ? 'Proven' : 
               frame.your_channel_fit === 'gap' ? 'Opportunity' : 
               'Untested'}
            </span>
              </div>
            </div>
            {!concepts ? (
              <button
                onClick={() => generateConceptsForFrame(frameIndex)}
                disabled={generatingForFrame === frameIndex}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all flex items-center gap-2 shadow-lg hover:shadow-xl"
              >
                {generatingForFrame === frameIndex ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating Concepts...
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4" />
                    Generate Packaging
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => setShowConcepts(!showConcepts)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {showConcepts ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Hide Concepts
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Show Concepts ({concepts.concepts?.length || 0})
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        
        {/* Channel Fit Analysis - Show WHY this matters for your channel */}
        {frame.channel_fit_reasoning && (
          <div className={`mb-8 p-4 rounded-lg border ${
            frame.your_channel_fit === 'proven' 
              ? 'bg-blue-900/20 border-blue-800' 
              : frame.your_channel_fit === 'gap'
              ? 'bg-amber-900/20 border-amber-800'
              : 'bg-zinc-800/30 border-zinc-700'
          }`}>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-200 mb-2">
                  Why this {frame.your_channel_fit === 'proven' ? 'works for you' : frame.your_channel_fit === 'gap' ? 'is an opportunity' : 'could work'}:
                </p>
                <p className="text-sm text-zinc-400">{frame.channel_fit_reasoning}</p>
                {frame.your_proven_examples && frame.your_proven_examples.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-zinc-500 mb-1">Your videos using this:</p>
                    {frame.your_proven_examples.map((example, i) => (
                      <p key={i} className="text-sm text-blue-400">• {example}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Pattern Analysis Grid - No black backgrounds */}
        <div className="grid grid-cols-3 gap-6 mb-10">
          <div className={`p-5 border rounded-lg ${
            isActive ? 'border-zinc-600 bg-zinc-800/40' : 'border-zinc-700 bg-zinc-800/30'
          }`}>
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wide font-medium">Thumbnail Pattern</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{frame.multi_modal_evidence.thumbnail_pattern}</p>
          </div>
          <div className={`p-5 border rounded-lg ${
            isActive ? 'border-zinc-600 bg-zinc-800/40' : 'border-zinc-700 bg-zinc-800/30'
          }`}>
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wide font-medium">Title Structure</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{frame.multi_modal_evidence.title_pattern}</p>
          </div>
          <div className={`p-5 border rounded-lg ${
            isActive ? 'border-zinc-600 bg-zinc-800/40' : 'border-zinc-700 bg-zinc-800/30'
          }`}>
            <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wide font-medium">Content Approach</p>
            <p className="text-sm text-zinc-300 leading-relaxed">{frame.multi_modal_evidence.content_pattern}</p>
          </div>
        </div>

        {/* Application Section */}
        <div className="mb-10">
          <h4 className="text-base font-medium text-zinc-100 mb-4">How to Apply This Pattern</h4>
          <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
            {frame.application_to_your_concept.adaptation_strategy}
          </p>
            
          {frame.application_to_your_concept.specific_recommendations.length > 0 && (
            <div className="space-y-3">
              {frame.application_to_your_concept.specific_recommendations
                .slice(0, showAllRecs ? undefined : 3)
                .map((rec, recIndex) => (
                  <div key={recIndex} className="flex items-start gap-3">
                    <span className="text-blue-400 mt-0.5">→</span>
                    <span className="text-sm text-zinc-300">{rec}</span>
                  </div>
                ))}
            </div>
          )}
            
          {frame.application_to_your_concept.specific_recommendations.length > 3 && (
            <button
              onClick={() => setShowAllRecs(!showAllRecs)}
              className="text-sm text-blue-400 hover:text-blue-300 mt-4"
            >
              {showAllRecs ? 'Show less' : `Show ${frame.application_to_your_concept.specific_recommendations.length - 3} more`}
            </button>
          )}
        </div>

        {/* Generated Concepts Section */}
        {concepts && showConcepts && (
          <div className="mt-8 p-6 bg-gradient-to-b from-blue-900/10 to-zinc-900/50 rounded-xl border border-blue-800/50">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h4 className="text-lg font-medium text-zinc-100">Generated Video Concepts</h4>
                <p className="text-sm text-zinc-400 mt-1">
                  {concepts.concepts?.length || 0} video ideas based on {frame.frame_name}
                </p>
              </div>
              {concepts.quick_win && (
                <div className="text-sm text-blue-400">
                  ⚡ {typeof concepts.quick_win === 'number' ? `Start with: Concept #${concepts.quick_win}` : concepts.quick_win}
                </div>
              )}
            </div>
            
            <div className="space-y-4">
              {concepts.concepts?.map((concept: any, i: number) => {
                const conceptId = `${frameIndex}-${i}`;
                const isSelected = selectedConcepts.some(sc => sc.id === conceptId);
                
                return (
                  <div key={i} className="group relative p-5 bg-zinc-800/40 hover:bg-zinc-800/60 rounded-lg border border-zinc-700 hover:border-zinc-600 transition-all">
                    {/* Concept Number Badge */}
                    <div className="absolute -top-2 -left-2 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                      {i + 1}
                    </div>
                    
                    {/* Selection Checkbox */}
                    <input
                      type="checkbox"
                      className="absolute top-4 right-4 w-5 h-5 text-blue-600 bg-zinc-800 border-zinc-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const userConcept = JSON.parse(conceptJson) as MultiDimensionalConcept;
                          setSelectedConcepts(prev => [...prev, {
                            id: conceptId,
                            frameIndex,
                            frameName: frame.frame_name,
                            concept,
                            context: {
                              frame,
                              transcript,
                              userConcept,
                              searchResults
                            }
                          }]);
                        } else {
                          setSelectedConcepts(prev => prev.filter(sc => sc.id !== conceptId));
                        }
                      }}
                    />
                    
                    <div className="mb-4">
                    <h5 className="font-medium text-zinc-100 text-base mb-2 pr-20">{concept.title}</h5>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        {Math.round((concept.confidence || 0.8) * 100)}% match
                      </span>
                      {concept.why_it_works && (
                        <span className="text-zinc-500">• {concept.why_it_works}</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-zinc-500 uppercase mb-2 font-medium">Thumbnail</p>
                      <div className="space-y-1">
                        <p className="text-sm text-zinc-300">{concept.thumbnail_text || concept.thumbnail?.text_overlay}</p>
                        {concept.thumbnail_visual && (
                          <p className="text-xs text-zinc-400 italic">{concept.thumbnail_visual}</p>
                        )}
                      </div>
                    </div>
                    <div className="lg:col-span-2">
                      <p className="text-xs text-zinc-500 uppercase mb-2 font-medium">Opening Hook</p>
                      <p className="text-sm text-zinc-300 italic">"{concept.hook}"</p>
                    </div>
                  </div>
                  
                  {concept.content_outline && concept.content_outline.length > 0 && (
                    <div className="mb-4 p-3 bg-zinc-900/50 rounded border border-zinc-800">
                      <p className="text-xs text-zinc-500 uppercase mb-1 font-medium">Content Structure</p>
                      <div className="space-y-1">
                        {concept.content_outline.map((section: string, idx: number) => (
                          <p key={idx} className="text-sm text-zinc-400">{section}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {concept.production_tip && (
                    <div className="mb-4 p-3 bg-zinc-900/50 rounded border border-zinc-800">
                      <p className="text-xs text-zinc-500 uppercase mb-1">Production Tip</p>
                      <p className="text-sm text-zinc-400">{concept.production_tip}</p>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(concept.title);
                        // Could add a toast notification here
                      }}
                      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-sm rounded transition-colors flex items-center gap-1"
                    >
                      📋 Copy Title
                    </button>
                    <button 
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-sm text-white rounded transition-colors"
                    >
                      Create Script →
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
            
            {concepts.batch_strategy && (
              <div className="mt-6 p-4 bg-zinc-800/30 rounded-lg border border-zinc-700">
                <p className="text-xs text-zinc-500 uppercase mb-2 font-medium">Release Strategy</p>
                <p className="text-sm text-zinc-300">{concepts.batch_strategy}</p>
              </div>
            )}
          </div>
        )}
        
        {/* Example Videos */}
        {frame.example_videos.length > 0 && (
          <div>
            <h4 className="text-sm text-zinc-400 mb-4 font-medium">Example Videos</h4>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {frame.example_videos.map((videoTitle, videoIndex) => {
                const matchedVideo = searchResults.find(v => v.title === videoTitle);
                
                return (
                  <div key={videoIndex} className="flex-shrink-0 w-56">
                    {matchedVideo ? (
                      <div>
                        <div className="aspect-video relative overflow-hidden rounded-lg bg-zinc-900">
                          <img 
                            src={matchedVideo.thumbnail_url}
                            alt={videoTitle}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="mt-2">
                          <p className="text-xs text-zinc-100 line-clamp-2 leading-snug">{videoTitle}</p>
                          <p className="text-xs text-zinc-500 mt-1">
                            {matchedVideo.temporal_performance_score.toFixed(1)}x • {(matchedVideo.view_count / 1000).toFixed(0)}K views
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="aspect-video flex items-center justify-center bg-zinc-900 rounded-lg">
                          <Video className="w-6 h-6 text-zinc-600" />
                        </div>
                        <div className="mt-2">
                          <p className="text-xs text-zinc-400 line-clamp-2">{videoTitle}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderIterationStep = () => {
    if (selectedConcepts.length === 0) {
      return (
        <div className="max-w-6xl mx-auto px-6">
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <Lightbulb className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Concepts Selected</h3>
              <p className="text-zinc-400 mb-6">Go back to step 5 and select some concepts to iterate on.</p>
              <Button onClick={() => setCurrentStep(5)} variant="outline">
                ← Back to Frame Analysis
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Iterate & Refine</h2>
          <p className="text-zinc-400">Generate variations for titles, hooks, and thumbnails. Each click generates new options that are added to your collection.</p>
        </div>

        {/* Selected Concepts Grid */}
        <div className="space-y-6">
          {selectedConcepts.map((selected) => (
            <IterationCard
              key={selected.id}
              selected={selected}
              onUpdateVariations={(type, newVariations) => {
                // Append new variations to existing ones
                setSelectedConcepts(prev => prev.map(sc => 
                  sc.id === selected.id 
                    ? {
                        ...sc,
                        variations: {
                          ...sc.variations,
                          [type]: [...(sc.variations?.[type] || []), ...newVariations]
                        }
                      }
                    : sc
                ));
              }}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Compact Header */}
      <div className="border-b border-zinc-800">
        <div className="px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <h1 className="text-base font-medium text-zinc-100">
                Concept Package Tool
              </h1>
              <span className="text-sm text-zinc-500">
                Transform audio into YouTube videos using proven patterns
              </span>
              {/* Session indicator */}
              {(conceptJson || searchResults.length > 0 || frameAnalysis || transcript) && (
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <div className="w-1 h-1 bg-green-500 rounded-full" />
                  <span>
                    {[conceptJson && 'Concept', searchResults.length > 0 && `${searchResults.length} videos`, frameAnalysis && 'Frames', transcript && 'Transcript'].filter(Boolean).join(' • ')}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={clearCache}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Clear session data"
            >
              Clear session
            </button>
          </div>
        </div>
        
        {/* Step Indicator - Inline */}
        <div className="px-6 py-2 bg-zinc-900/50">
          {renderStepIndicator()}
        </div>
      </div>

      {/* Step Content */}
      <div className="">
        {currentStep === 1 && <div className="max-w-6xl mx-auto px-6 py-8">{renderUploadStep()}</div>}
        {currentStep === 2 && <div className="max-w-6xl mx-auto px-6 py-8">{renderTranscriptStep()}</div>}
        {currentStep === 3 && <div className="max-w-6xl mx-auto px-6 py-8">{renderConceptStep()}</div>}
        {currentStep === 4 && <div className="max-w-6xl mx-auto px-6 py-8">{renderSearchStep()}</div>}
        {currentStep === 5 && <div className="py-8">{renderFrameAnalysisStep()}</div>}
        {currentStep === 6 && <div className="py-8">{renderIterationStep()}</div>}
      </div>
      
      {/* Floating selection indicator */}
      {selectedConcepts.length > 0 && currentStep === 5 && (
        <div className="fixed bottom-8 right-8 bg-blue-600 text-white rounded-xl shadow-2xl p-4 flex items-center gap-4 animate-in slide-in-from-bottom-5">
          <div>
            <p className="text-sm font-medium">{selectedConcepts.length} concepts selected</p>
            <p className="text-xs opacity-80">Ready to iterate on titles & thumbnails</p>
          </div>
          <Button
            onClick={() => setCurrentStep(6)}
            className="bg-white text-blue-600 hover:bg-zinc-100"
            size="sm"
          >
            Continue to Iterate →
          </Button>
        </div>
      )}
    </div>
  );
}
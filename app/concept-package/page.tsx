'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Upload, FileAudio, Brain, Search, Package, ChevronDown, Check,
  AlertCircle, TrendingUp, Lightbulb, CheckCircle, Target, Camera, 
  FileText, Video
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
  recommendation: 'leverage_strength' | 'fill_gap' | 'improve_existing';
}

interface FrameAnalysis {
  discovered_frames: DiscoveredFrame[];
  cross_frame_insights: string;
  strategic_summary: string;
}

export default function ConceptPackagePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [conceptJson, setConceptJson] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [frameAnalysis, setFrameAnalysis] = useState<FrameAnalysis | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [channelSearchResults, setChannelSearchResults] = useState<Channel[]>([]);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const channelDropdownRef = useRef<HTMLDivElement>(null);

  // Cache keys for localStorage
  const CACHE_KEYS = {
    conceptJson: 'concept-package-json',
    searchResults: 'concept-package-search-results',
    frameAnalysis: 'concept-package-frame-analysis',
    selectedChannel: 'concept-package-selected-channel',
    transcript: 'concept-package-transcript'
  };

  // Load cached data on component mount
  useEffect(() => {
    const loadCachedData = () => {
      try {
        // Load concept JSON
        const cachedJson = localStorage.getItem(CACHE_KEYS.conceptJson);
        if (cachedJson) {
          setConceptJson(cachedJson);
        }

        // Load search results
        const cachedResults = localStorage.getItem(CACHE_KEYS.searchResults);
        if (cachedResults) {
          const results = JSON.parse(cachedResults);
          setSearchResults(results);
          if (results.length > 0) {
            setCurrentStep(Math.max(currentStep, 4));
          }
        }

        // Load frame analysis
        const cachedFrames = localStorage.getItem(CACHE_KEYS.frameAnalysis);
        if (cachedFrames) {
          const frames = JSON.parse(cachedFrames);
          setFrameAnalysis(frames);
          if (frames) {
            setCurrentStep(Math.max(currentStep, 5));
          }
        }

        // Load selected channel
        const cachedChannel = localStorage.getItem(CACHE_KEYS.selectedChannel);
        if (cachedChannel) {
          const channel = JSON.parse(cachedChannel);
          setSelectedChannel(channel);
          setChannelSearchQuery(channel.channel_name);
        }

        // Load transcript
        const cachedTranscript = localStorage.getItem(CACHE_KEYS.transcript);
        if (cachedTranscript) {
          setTranscript(cachedTranscript);
          if (cachedTranscript.length > 0) {
            setCurrentStep(Math.max(currentStep, 2));
          }
        }
      } catch (error) {
        console.error('Error loading cached data:', error);
      }
    };

    loadCachedData();
  }, []);

  // Save data to cache whenever it changes
  useEffect(() => {
    if (conceptJson) {
      localStorage.setItem(CACHE_KEYS.conceptJson, conceptJson);
    }
  }, [conceptJson]);

  useEffect(() => {
    if (searchResults.length > 0) {
      localStorage.setItem(CACHE_KEYS.searchResults, JSON.stringify(searchResults));
    }
  }, [searchResults]);

  useEffect(() => {
    if (frameAnalysis) {
      localStorage.setItem(CACHE_KEYS.frameAnalysis, JSON.stringify(frameAnalysis));
    }
  }, [frameAnalysis]);

  useEffect(() => {
    if (selectedChannel) {
      localStorage.setItem(CACHE_KEYS.selectedChannel, JSON.stringify(selectedChannel));
    }
  }, [selectedChannel]);

  useEffect(() => {
    if (transcript) {
      localStorage.setItem(CACHE_KEYS.transcript, transcript);
    }
  }, [transcript]);

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
    { number: 5, title: 'Extract Frames', icon: Package, description: 'Discover successful patterns' }
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
    <div className="mb-8">
      <div className="flex items-center justify-center space-x-4 mb-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.number === currentStep;
          const isComplete = step.number < currentStep;
          const isClickable = step.number <= currentStep || step.number === 3;
          
          return (
            <div key={step.number} className="flex items-center">
              <div 
                className={`
                  flex items-center justify-center w-10 h-10 rounded-full border-2 cursor-pointer transition-all
                  ${isActive ? 'border-primary bg-primary text-primary-foreground' : 
                    isComplete ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600' : 
                    isClickable ? 'border-muted-foreground text-muted-foreground hover:border-primary hover:text-primary' :
                    'border-muted text-muted cursor-not-allowed'}
                `}
                onClick={() => isClickable && setCurrentStep(step.number)}
                title={isClickable ? `Go to ${step.title}` : step.description}
              >
                <Icon size={16} />
              </div>
              {index < steps.length - 1 && (
                <div className={`w-16 h-0.5 ${isComplete ? 'bg-emerald-500' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
      
      <div className="flex items-center justify-center space-x-4">
        {steps.map((step, index) => {
          const isActive = step.number === currentStep;
          const isClickable = step.number <= currentStep || step.number === 3;
          
          return (
            <div key={`label-${step.number}`} className="flex items-center">
              <div className="w-10 text-center">
                <span 
                  className={`text-xs font-medium cursor-pointer ${
                    isActive ? 'text-primary' : 
                    isClickable ? 'text-foreground hover:text-primary' : 'text-muted-foreground'
                  }`}
                  onClick={() => isClickable && setCurrentStep(step.number)}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && <div className="w-16" />}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderUploadStep = () => (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload MP3 Audio File
          </CardTitle>
          <CardDescription>
            Upload your audio file to start the concept repackaging process
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isProcessing ? (
            <div className="space-y-4">
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
            Your audio has been successfully transcribed. Review and continue to concept extraction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="max-h-60 overflow-y-auto p-4 bg-muted/30 rounded-lg border">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {transcript}
              </p>
            </div>
            
            <div className="flex justify-center">
              <Button 
                onClick={() => setCurrentStep(3)}
                className="px-8 py-2"
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

    // Frame analysis results
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <Package className="w-6 h-6 text-muted-foreground" />
                  Frame Extraction Complete
                </CardTitle>
                <CardDescription className="text-base mt-2">
                  Discovered {frameAnalysis.discovered_frames.length} successful patterns across {searchResults.length} videos
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="px-3 py-1">
                  {frameAnalysis.discovered_frames.length} Frames
                </Badge>
                <Badge variant="outline" className="px-3 py-1">
                  {searchResults.length} Videos
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="p-4 bg-muted/30 border border-border rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-foreground mb-2">Strategic Summary</h4>
                  <p className="text-muted-foreground leading-relaxed">{frameAnalysis.strategic_summary}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cross-Frame Insights */}
        {frameAnalysis.cross_frame_insights && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-muted-foreground" />
                Cross-Frame Insights
              </CardTitle>
              <CardDescription>
                Patterns and connections across all discovered frames
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-muted/30 border border-border rounded-lg">
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <p className="text-foreground leading-relaxed">{frameAnalysis.cross_frame_insights}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Discovered Frames */}
        <div className="space-y-6">
          {frameAnalysis.discovered_frames.map((frame, index) => (
            <Card key={index} className="border-l-4 border-l-primary">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-1">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-xl leading-tight">
                        {frame.frame_name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Strategic pattern discovered across multiple videos
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Badge variant="secondary" className="font-medium">
                        {frame.frequency} videos
                      </Badge>
                      <Badge variant="outline" className="font-medium">
                        {Math.round(frame.confidence_score * 100)}% confidence
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-0">
                {/* Channel Fit & Recommendation */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/30 border border-border rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <CheckCircle className="w-5 h-5 text-muted-foreground" />
                      <h4 className="font-semibold text-foreground">Your Channel Fit</h4>
                    </div>
                    <Badge 
                      variant={
                        frame.your_channel_fit === 'proven' ? 'default' :
                        frame.your_channel_fit === 'gap' ? 'destructive' :
                        frame.your_channel_fit === 'untested' ? 'secondary' :
                        'outline'
                      } 
                      className="capitalize"
                    >
                      {frame.your_channel_fit.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="p-4 bg-muted/30 border border-border rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <Target className="w-5 h-5 text-muted-foreground" />
                      <h4 className="font-semibold text-foreground">Recommendation</h4>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {frame.recommendation.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>

                {/* Multi-Modal Evidence */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="p-4 bg-muted/30 border border-border rounded-lg">
                    <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                      <Camera className="w-4 h-4 text-muted-foreground" />
                      Thumbnail Pattern
                    </h4>
                    <p className="text-sm text-muted-foreground">{frame.multi_modal_evidence.thumbnail_pattern}</p>
                  </div>
                  <div className="p-4 bg-muted/30 border border-border rounded-lg">
                    <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Title Pattern
                    </h4>
                    <p className="text-sm text-muted-foreground">{frame.multi_modal_evidence.title_pattern}</p>
                  </div>
                  <div className="p-4 bg-muted/30 border border-border rounded-lg">
                    <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                      <Video className="w-4 h-4 text-muted-foreground" />
                      Content Pattern
                    </h4>
                    <p className="text-sm text-muted-foreground">{frame.multi_modal_evidence.content_pattern}</p>
                  </div>
                </div>

                {/* Application to Your Concept */}
                <div className="p-4 bg-muted/30 border border-border rounded-lg">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                        Application to Your Concept
                        <Badge variant="secondary" className="text-xs">
                          {Math.round(frame.application_to_your_concept.confidence * 100)}% confidence
                        </Badge>
                      </h4>
                      <p className="text-foreground/80 mb-3">{frame.application_to_your_concept.adaptation_strategy}</p>
                      
                      <div className="space-y-2">
                        <h5 className="font-medium text-foreground">Specific Recommendations:</h5>
                        <ul className="space-y-1">
                          {frame.application_to_your_concept.specific_recommendations.map((rec, recIndex) => (
                            <li key={recIndex} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-muted-foreground mt-0.5">•</span>
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Example Videos */}
                {frame.example_videos.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground flex items-center gap-2">
                      <Video className="w-4 h-4 text-muted-foreground" />
                      Example Videos Using This Frame
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {frame.example_videos.slice(0, 3).map((videoTitle, videoIndex) => {
                        // Try to find the video in searchResults to get the thumbnail
                        const matchedVideo = searchResults.find(v => v.title === videoTitle);
                        
                        return (
                          <div key={videoIndex} className="bg-muted/30 border border-border rounded-lg overflow-hidden">
                            {matchedVideo ? (
                              <>
                                <div className="aspect-video bg-muted">
                                  <img 
                                    src={matchedVideo.thumbnail_url}
                                    alt={videoTitle}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="p-3">
                                  <p className="text-sm font-medium line-clamp-2">{videoTitle}</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {matchedVideo.view_count.toLocaleString()} views • {matchedVideo.temporal_performance_score.toFixed(1)}x
                                  </p>
                                </div>
                              </>
                            ) : (
                              <div className="p-3">
                                <p className="text-sm font-medium line-clamp-2">{videoTitle}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {frame.example_videos.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{frame.example_videos.length - 3} more videos using this pattern
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

        </div>

        {/* Action Buttons */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Analysis complete • {frameAnalysis.discovered_frames.length} frames discovered
              </div>
              
              <div className="flex gap-3">
                <Button 
                  variant="outline"
                  onClick={() => setCurrentStep(4)}
                >
                  Back to Search
                </Button>
                <Button 
                  className="px-6 py-2"
                  onClick={() => {
                    alert('Next: Generate creative outputs from frames (coming soon!)');
                  }}
                >
                  Generate Creative Outputs
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-between mb-4">
            <div className="w-32"></div> {/* Spacer */}
            <h1 className="text-4xl font-bold">
              🎧 MP3 → Concept Package Tool
            </h1>
            <div className="w-32 flex justify-end">
              <Button
                onClick={clearCache}
                variant="outline"
                size="sm"
                title="Clear all cached data and restart"
              >
                🔄 Restart
              </Button>
            </div>
          </div>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Transform your audio content into viral video concepts by discovering what already works in your niche
          </p>
          
          {/* Cache Status Indicator */}
          {(conceptJson || searchResults.length > 0 || frameAnalysis || transcript) && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span>Session data cached</span>
              <span className="text-xs text-primary/80">
                ({[conceptJson && 'JSON', searchResults.length > 0 && 'Search', frameAnalysis && 'Frames', transcript && 'Transcript'].filter(Boolean).join(', ')})
              </span>
            </div>
          )}
        </div>

        {/* Step Indicator */}
        {renderStepIndicator()}

        {/* Step Content */}
        <div className="mt-8">
          {currentStep === 1 && renderUploadStep()}
          {currentStep === 2 && renderTranscriptStep()}
          {currentStep === 3 && renderConceptStep()}
          {currentStep === 4 && renderSearchStep()}
          {currentStep === 5 && renderFrameAnalysisStep()}
        </div>
      </div>
    </div>
  );
}
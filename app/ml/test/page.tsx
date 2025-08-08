'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Clock, Target } from 'lucide-react';

interface PredictionResult {
  predicted_multiplier: number;
  confidence_interval: [number, number];
  log_multiplier: number;
  factors: Array<{
    feature: string;
    importance: number;
    value: any;
  }>;
  model_version: string;
}

const formatTypes = [
  'case_study',
  'compilation', 
  'explainer',
  'listicle',
  'live_stream',
  'news_analysis',
  'personal_story',
  'product_focus',
  'shorts',
  'tutorial',
  'update',
  'vlog'
];

export default function MLTestPage() {
  const [formData, setFormData] = useState({
    title: '',
    topic_cluster_id: 0,
    format_type: '',
    channel_id: '',
    planned_publish_time: ''
  });
  
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handlePredict = async () => {
    if (!formData.title || !formData.format_type) {
      setError('Please fill in title and format type');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/ml/predict-performance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      setPrediction(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get prediction');
    } finally {
      setLoading(false);
    }
  };

  const loadExampleVideo = (example: 'fitness' | 'woodworking' | 'tech' | 'viral') => {
    const examples = {
      fitness: {
        title: 'The Ultimate Bench Press Technique for Maximum Gains',
        topic_cluster_id: 23,
        format_type: 'tutorial',
        channel_id: 'Athlean-X',
        planned_publish_time: '2025-08-06T15:00:00Z'
      },
      woodworking: {
        title: 'Building a Custom Cabinet with Hidden Storage',
        topic_cluster_id: 166,
        format_type: 'tutorial',
        channel_id: 'Steve Ramsey - WWMM',
        planned_publish_time: '2025-08-06T12:00:00Z'
      },
      tech: {
        title: 'Why Everyone is Wrong About AI',
        topic_cluster_id: 17,
        format_type: 'explainer',
        channel_id: 'Veritasium',
        planned_publish_time: '2025-08-06T10:00:00Z'
      },
      viral: {
        title: 'I Gave $10,000 to Random Strangers',
        topic_cluster_id: 14,
        format_type: 'personal_story',
        channel_id: 'MrBeast',
        planned_publish_time: '2025-08-06T20:00:00Z'
      }
    };
    
    setFormData(examples[example]);
    setPrediction(null);
    setError(null);
  };

  const getPerformanceColor = (multiplier: number) => {
    if (multiplier >= 2.0) return 'text-green-600';
    if (multiplier >= 1.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPerformanceLabel = (multiplier: number) => {
    if (multiplier >= 2.0) return 'High Performance';
    if (multiplier >= 1.5) return 'Above Average';
    if (multiplier >= 0.8) return 'Average';
    return 'Below Average';
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ML Performance Predictor</h1>
        <p className="text-gray-600">
          Test the YouTube video performance prediction model with your video ideas
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle>Video Details</CardTitle>
            <CardDescription>
              Enter your video information to get a performance prediction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Example Videos */}
            <div>
              <Label className="text-sm font-medium">Quick Examples</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => loadExampleVideo('fitness')}>
                  Fitness
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleVideo('woodworking')}>
                  Woodworking
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleVideo('tech')}>
                  Tech
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleVideo('viral')}>
                  Viral Story
                </Button>
              </div>
            </div>

            {/* Title Input */}
            <div>
              <Label htmlFor="title">Video Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="Enter your video title..."
                className="mt-1"
              />
            </div>

            {/* Format Type */}
            <div>
              <Label htmlFor="format">Content Format *</Label>
              <Select 
                value={formData.format_type} 
                onValueChange={(value) => handleInputChange('format_type', value)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select format type" />
                </SelectTrigger>
                <SelectContent>
                  {formatTypes.map(format => (
                    <SelectItem key={format} value={format}>
                      {format.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Topic Cluster */}
            <div>
              <Label htmlFor="topic">Topic Cluster ID</Label>
              <Input
                id="topic"
                type="number"
                value={formData.topic_cluster_id}
                onChange={(e) => handleInputChange('topic_cluster_id', parseInt(e.target.value) || 0)}
                placeholder="0-216 (0 for unknown)"
                className="mt-1"
              />
            </div>

            {/* Publish Time */}
            <div>
              <Label htmlFor="publish_time">Planned Publish Time</Label>
              <Input
                id="publish_time"
                type="datetime-local"
                value={formData.planned_publish_time.slice(0, -1)}
                onChange={(e) => handleInputChange('planned_publish_time', e.target.value + 'Z')}
                className="mt-1"
              />
            </div>

            {/* Channel Name */}
            <div>
              <Label htmlFor="channel">Channel Name (optional)</Label>
              <Input
                id="channel"
                value={formData.channel_id}
                onChange={(e) => handleInputChange('channel_id', e.target.value)}
                placeholder="e.g., Steve Ramsey - WWMM, Athlean-X, Veritasium"
                className="mt-1"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="text-red-600 text-sm p-2 bg-red-50 rounded">
                {error}
              </div>
            )}

            {/* Predict Button */}
            <Button 
              onClick={handlePredict} 
              disabled={loading || !formData.title || !formData.format_type}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Predicting...
                </>
              ) : (
                <>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Get Prediction
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results Display */}
        <Card>
          <CardHeader>
            <CardTitle>Prediction Results</CardTitle>
            <CardDescription>
              Performance prediction and contributing factors
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!prediction ? (
              <div className="text-center text-gray-500 py-8">
                <Target className="mx-auto h-12 w-12 mb-4 opacity-30" />
                <p>Enter video details and click "Get Prediction" to see results</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Main Prediction */}
                <div className="text-center">
                  <div className={`text-4xl font-bold ${getPerformanceColor(prediction.predicted_multiplier)}`}>
                    {prediction.predicted_multiplier}x
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Expected Performance Multiplier
                  </div>
                  <Badge variant="secondary" className="mt-2">
                    {getPerformanceLabel(prediction.predicted_multiplier)}
                  </Badge>
                </div>

                {/* Confidence Interval */}
                <div className="bg-slate-800 border border-slate-600 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-white">Confidence Range:</span>
                    <span className="text-base font-bold text-white">
                      {prediction.confidence_interval[0]}x - {prediction.confidence_interval[1]}x
                    </span>
                  </div>
                  <div className="w-full bg-slate-600 rounded-full h-4 mt-3">
                    <div 
                      className="bg-green-400 h-4 rounded-full"
                      style={{
                        width: `${Math.min(100, (prediction.predicted_multiplier / Math.max(prediction.confidence_interval[1], 3)) * 100)}%`
                      }}
                    />
                  </div>
                </div>

                {/* Contributing Factors */}
                <div>
                  <h4 className="font-semibold mb-4 text-white text-lg">Top Contributing Factors</h4>
                  <div className="space-y-3">
                    {prediction.factors.map((factor, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-slate-800 border border-slate-600 rounded-lg">
                        <div>
                          <div className="font-bold text-base text-white">{factor.feature}</div>
                          <div className="text-base text-slate-300 mt-1">{factor.value}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-green-400">
                            {(factor.importance * 100).toFixed(1)}%
                          </div>
                          <div className="text-sm text-slate-400">importance</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Model Info */}
                <div className="text-base text-white border-t border-slate-600 pt-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Model: {prediction.model_version}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Additional Info */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h3 className="font-medium mb-2">How it works</h3>
          <p className="text-sm text-gray-600 mb-4">
            This ML model predicts video performance using XGBoost trained on 50K+ YouTube videos. 
            It analyzes content format, timing, topic clusters, and title characteristics to predict 
            how your video will perform relative to channel baseline.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-medium text-green-600">High Performance (2.0x+)</div>
              <div className="text-gray-600">Expected to significantly outperform baseline</div>
            </div>
            <div>
              <div className="font-medium text-yellow-600">Above Average (1.5-2.0x)</div>
              <div className="text-gray-600">Expected to perform better than typical</div>
            </div>
            <div>
              <div className="font-medium text-red-600">Below Average (&lt;1.0x)</div>
              <div className="text-gray-600">May underperform channel baseline</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
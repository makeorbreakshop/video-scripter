import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Global model cache (in production, consider Redis or similar)
let modelCache: any = null;
let modelMetadata: any = null;

interface PredictionRequest {
  title: string;
  topic_cluster_id: number;
  format_type: string;
  channel_id?: string;
  planned_publish_time?: string;
  // For testing with historical data
  day_1_views?: number;
  day_3_views?: number;
  day_7_views?: number;
  channel_baseline?: number;
}

interface PredictionResponse {
  predicted_multiplier: number;
  confidence_interval: [number, number];
  log_multiplier: number;
  factors: Array<{
    feature: string;
    importance: number;
    value: any;
  }>;
  similar_videos?: Array<{
    video_id: string;
    title: string;
    actual_multiplier: number;
  }>;
  model_version: string;
}

async function loadModel() {
  if (modelCache && modelMetadata) {
    return { model: modelCache, metadata: modelMetadata };
  }

  try {
    // Find the latest model file
    const modelsDir = path.join(process.cwd(), 'models');
    const files = fs.readdirSync(modelsDir);
    const modelFiles = files.filter(f => f.endsWith('_metadata.json'));
    
    if (modelFiles.length === 0) {
      throw new Error('No trained models found');
    }

    // Get the latest model
    const latestModel = modelFiles.sort().reverse()[0];
    const metadataPath = path.join(modelsDir, latestModel);
    
    // Load metadata
    const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
    modelMetadata = JSON.parse(metadataContent);
    
    console.log(`Loaded model: ${modelMetadata.model_id}`);
    
    // Note: In a real implementation, we'd load the actual Python model
    // For now, we'll simulate predictions using the metadata
    modelCache = { loaded: true, metadata: modelMetadata };
    
    return { model: modelCache, metadata: modelMetadata };
  } catch (error) {
    console.error('Error loading model:', error);
    throw new Error('Failed to load ML model');
  }
}

function calculateFeatures(request: PredictionRequest, channelBaseline: number) {
  const publishTime = request.planned_publish_time ? new Date(request.planned_publish_time) : new Date();
  
  // Basic features
  const features = {
    topic_cluster_id: request.topic_cluster_id,
    format_type: request.format_type,
    day_of_week: publishTime.getDay(),
    hour_of_day: publishTime.getHours(),
    title_word_count: request.title.split(' ').length,
    // Early performance signals (for testing/validation)
    day_1_log_multiplier: request.day_1_views && channelBaseline > 0 
      ? Math.log(request.day_1_views) - Math.log(channelBaseline) 
      : 0,
    day_3_log_multiplier: request.day_3_views && channelBaseline > 0
      ? Math.log(request.day_3_views) - Math.log(channelBaseline)
      : 0,
    day_7_log_multiplier: request.day_7_views && channelBaseline > 0
      ? Math.log(request.day_7_views) - Math.log(channelBaseline)
      : 0,
    view_velocity_3_7: request.day_3_views && request.day_7_views && request.day_3_views > 0
      ? (request.day_7_views - request.day_3_views) / request.day_3_views
      : 0
  };

  return features;
}

function simulateModelPrediction(features: any, metadata: any): number {
  // Simple heuristic-based prediction for demo
  // In production, this would call the actual Python model
  
  let logMultiplier = 0;
  
  // Early performance signals are most important
  if (features.day_1_log_multiplier !== 0) {
    logMultiplier += features.day_1_log_multiplier * 0.6;
  }
  if (features.day_7_log_multiplier !== 0) {
    logMultiplier += features.day_7_log_multiplier * 0.3;
  }
  
  // Format adjustments
  const formatBoosts: { [key: string]: number } = {
    'tutorial': 0.1,
    'listicle': 0.05,
    'case_study': 0.15,
    'product_focus': 0.08,
    'explainer': 0.12
  };
  
  logMultiplier += formatBoosts[features.format_type] || 0;
  
  // Topic cluster adjustments (simplified)
  if (features.topic_cluster_id > 0 && features.topic_cluster_id < 50) {
    logMultiplier += 0.1; // Popular topics get boost
  }
  
  // Title length (sweet spot around 8-12 words)
  const titleLen = features.title_word_count;
  if (titleLen >= 8 && titleLen <= 12) {
    logMultiplier += 0.05;
  }
  
  // Random noise to simulate model uncertainty
  logMultiplier += (Math.random() - 0.5) * 0.2;
  
  // Cap predictions
  return Math.max(-3, Math.min(3, logMultiplier));
}

function getTopFactors(features: any, metadata: any) {
  const factors = [];
  
  if (features.day_1_log_multiplier !== 0) {
    factors.push({
      feature: 'Day 1 Performance',
      importance: 0.6,
      value: `${Math.exp(features.day_1_log_multiplier).toFixed(2)}x baseline`
    });
  }
  
  factors.push({
    feature: 'Content Format',
    importance: 0.2,
    value: features.format_type
  });
  
  factors.push({
    feature: 'Title Length',
    importance: 0.1,
    value: `${features.title_word_count} words`
  });
  
  return factors.slice(0, 3);
}

async function getChannelBaseline(channelId?: string): Promise<number> {
  // In production, look up actual channel baseline
  // For demo, return a reasonable default
  return channelId ? 50000 : 10000;
}

export async function POST(request: NextRequest) {
  try {
    const body: PredictionRequest = await request.json();
    
    // Validate required fields
    if (!body.title || !body.topic_cluster_id || !body.format_type) {
      return NextResponse.json(
        { error: 'Missing required fields: title, topic_cluster_id, format_type' },
        { status: 400 }
      );
    }
    
    // Load model
    const { model, metadata } = await loadModel();
    
    // Get channel baseline
    const channelBaseline = body.channel_baseline || await getChannelBaseline(body.channel_id);
    
    // Calculate features
    const features = calculateFeatures(body, channelBaseline);
    
    // Make prediction
    const logMultiplier = simulateModelPrediction(features, metadata);
    const multiplier = Math.exp(logMultiplier);
    
    // Calculate confidence interval (±1 standard deviation)
    const stdDev = 0.5; // From model training
    const confidenceInterval: [number, number] = [
      Math.exp(logMultiplier - stdDev),
      Math.exp(logMultiplier + stdDev)
    ];
    
    // Get top contributing factors
    const factors = getTopFactors(features, metadata);
    
    const response: PredictionResponse = {
      predicted_multiplier: Math.round(multiplier * 100) / 100,
      confidence_interval: [
        Math.round(confidenceInterval[0] * 100) / 100,
        Math.round(confidenceInterval[1] * 100) / 100
      ],
      log_multiplier: Math.round(logMultiplier * 1000) / 1000,
      factors,
      model_version: metadata.model_id
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Prediction error:', error);
    return NextResponse.json(
      { error: 'Failed to generate prediction' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { metadata } = await loadModel();
    
    return NextResponse.json({
      status: 'Model loaded',
      model_id: metadata.model_id,
      created_at: metadata.created_at,
      performance: metadata.performance,
      features: metadata.features.length
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Model not available' },
      { status: 500 }
    );
  }
}
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

async function callPythonModel(request: PredictionRequest, features: any): Promise<any> {
  // Call the actual Python XGBoost model
  const { spawn } = require('child_process');
  const path = require('path');
  
  return new Promise((resolve, reject) => {
    // Prepare input data for Python script
    const inputData = {
      title: request.title,
      topic_cluster_id: request.topic_cluster_id,
      format_type: request.format_type,
      planned_publish_time: request.planned_publish_time,
      // Include early performance signals if available
      day_1_log_multiplier: features.day_1_log_multiplier,
      day_7_log_multiplier: features.day_7_log_multiplier,
      view_velocity_3_7: features.view_velocity_3_7
    };
    
    // Spawn Python process
    const pythonPath = 'python'; // Adjust if needed
    const scriptPath = path.join(process.cwd(), 'scripts', 'ml_predict.py');
    const pythonProcess = spawn(pythonPath, [scriptPath]);
    
    let output = '';
    let error = '';
    
    // Send input data to Python script
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();
    
    // Collect output
    pythonProcess.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data: Buffer) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output.trim());
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse Python output: ${output}`));
        }
      } else {
        reject(new Error(`Python script failed with code ${code}: ${error}`));
      }
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      pythonProcess.kill();
      reject(new Error('Python model prediction timeout'));
    }, 10000);
  });
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
    
    // Make prediction using actual Python model
    const pythonResult = await callPythonModel(body, features);
    
    // Use results from Python model
    const multiplier = pythonResult.predicted_multiplier;
    const logMultiplier = pythonResult.log_multiplier;
    const confidenceInterval = pythonResult.confidence_interval;
    const factors = pythonResult.factors;
    
    const response: PredictionResponse = {
      predicted_multiplier: Math.round(multiplier * 100) / 100,
      confidence_interval: [
        Math.round(confidenceInterval[0] * 100) / 100,
        Math.round(confidenceInterval[1] * 100) / 100
      ],
      log_multiplier: Math.round(logMultiplier * 1000) / 1000,
      factors,
      model_version: pythonResult.model_version
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
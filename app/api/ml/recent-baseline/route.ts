import { NextRequest, NextResponse } from 'next/server';

interface ChannelData {
  channel_id: string;
  channel_name?: string;
  subscriber_count?: number;
  dominant_format?: string;
  dominant_topic_cluster?: number;
  avg_title_length?: number;
}

interface BaselineRequest {
  channel?: ChannelData;
  channels?: ChannelData[];
  num_videos?: number;
}

async function callPythonBaselineGenerator(request: BaselineRequest): Promise<any> {
  const { spawn } = require('child_process');
  const path = require('path');
  
  return new Promise((resolve, reject) => {
    // Prepare input data for Python script
    const inputData = {
      ...request,
      num_videos: request.num_videos || 10
    };
    
    // Spawn Python process
    const pythonPath = 'python';
    const scriptPath = path.join(process.cwd(), 'scripts', 'ml_recent_baseline_backfill.py');
    const pythonProcess = spawn(pythonPath, [scriptPath, '--api']);
    
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
    
    // Timeout after 30 seconds
    setTimeout(() => {
      pythonProcess.kill();
      reject(new Error('Baseline generation timeout'));
    }, 30000);
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: BaselineRequest = await request.json();
    
    // Validate required fields
    if (!body.channel && !body.channels) {
      return NextResponse.json(
        { error: 'Missing required field: channel or channels' },
        { status: 400 }
      );
    }
    
    // Generate ML baselines
    const result = await callPythonBaselineGenerator(body);
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate baselines' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      baselines: result.baselines,
      model_version: result.model_version
    });
    
  } catch (error) {
    console.error('Baseline generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate ML baselines' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ML Recent Baseline API',
    description: 'Generate ML-based recent baselines for channels with sparse data',
    endpoints: {
      'POST /': 'Generate baselines for channels'
    },
    example_request: {
      channel: {
        channel_id: 'UCgwaPlarb9k0PS2BQphCLNQ',
        channel_name: 'Steve Ramsey - WWMM',
        subscriber_count: 119000,
        dominant_format: 'tutorial',
        dominant_topic_cluster: 166,
        avg_title_length: 9
      },
      num_videos: 10
    }
  });
}
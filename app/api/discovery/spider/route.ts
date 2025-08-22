import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { headers } from 'next/headers';
import { getNicheSeeds } from '@/lib/educational-niches';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { nicheId, config, mode = 'test' } = await request.json();
    
    if (!nicheId) {
      return NextResponse.json(
        { error: 'nicheId is required' },
        { status: 400 }
      );
    }
    
    // Validate niche exists
    const niche = getNicheSeeds(nicheId);
    if (!niche) {
      return NextResponse.json(
        { error: `Unknown niche: ${nicheId}` },
        { status: 400 }
      );
    }
    
    // Get auth token
    const headersList = await headers();
    const authorization = headersList.get('authorization');
    const token = authorization?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get user from auth
    const { data: { user } } = await supabase.auth.getUser();
    
    console.log(`Starting educational discovery for niche: ${niche.name}`);
    console.log('Config:', config);
    console.log('Mode:', mode);
    
    // Run the REAL spider in a separate Node.js process
    return new Promise((resolve) => {
      const scriptPath = path.join(process.cwd(), 'scripts', 'run-real-educational-spider.js');
      const configStr = JSON.stringify(config);
      
      const spiderProcess = spawn('node', [scriptPath, nicheId, configStr, mode], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      let output = '';
      let errorOutput = '';
      
      spiderProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        console.log('Spider output:', chunk);
      });
      
      spiderProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        errorOutput += chunk;
        console.error('Spider error:', chunk);
      });
      
      spiderProcess.on('close', (code) => {
        console.log(`Spider process exited with code ${code}`);
        
        if (code === 0) {
          try {
            // Parse the JSON output from the spider
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const result = JSON.parse(lastLine);
            
            if (result.success) {
              resolve(NextResponse.json({
                success: true,
                message: result.message,
                nicheId,
                niche: {
                  name: niche.name,
                  description: niche.description,
                  seedChannels: niche.seedChannels.length
                },
                config,
                discovered: result.discovered || [],
                status: mode === 'production' ? 'completed_background' : 'completed',
                count: result.count || 0
              }));
            } else {
              resolve(NextResponse.json({
                error: result.error || 'Spider execution failed',
                details: result.stack
              }, { status: 500 }));
            }
          } catch (parseError) {
            console.error('Failed to parse spider output:', parseError);
            resolve(NextResponse.json({
              error: 'Failed to parse spider results',
              output: output,
              errorOutput: errorOutput
            }, { status: 500 }));
          }
        } else {
          resolve(NextResponse.json({
            error: 'Spider process failed',
            code,
            output: output,
            errorOutput: errorOutput
          }, { status: 500 }));
        }
      });
      
      spiderProcess.on('error', (error) => {
        console.error('Failed to start spider process:', error);
        resolve(NextResponse.json({
          error: 'Failed to start spider process',
          details: error.message
        }, { status: 500 }));
      });
      
      // Set a timeout for the process (web scraping takes longer)
      setTimeout(() => {
        if (!spiderProcess.killed) {
          spiderProcess.kill();
          resolve(NextResponse.json({
            error: 'Spider process timed out',
            timeout: '5 minutes'
          }, { status: 500 }));
        }
      }, 300000); // 5 minute timeout for web scraping
    });
    
  } catch (error) {
    console.error('Educational spider API error:', error);
    return NextResponse.json(
      { error: 'Failed to run educational spider', details: error.message },
      { status: 500 }
    );
  }
}
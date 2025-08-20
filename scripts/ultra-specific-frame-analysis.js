#!/usr/bin/env node
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function analyzeUltraSpecificFrames() {
  console.log('🎯 Finding ultra-specific psychological frames...\n');
  
  try {
    // Load the full dataset
    const dataPath = path.join(path.dirname(__dirname), 'exports', 'outliers-may-june-2025-2025-08-16.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const videos = data.videos;
    
    console.log(`📊 Analyzing ${videos.length} videos for ultra-specific frames\n`);

    // Define ultra-specific psychological frames
    const frames = {
      "Master Makes Complex Look Effortless": {
        patterns: [
          /just.*(?:cutting|making|doing|building)/i,
          /simply.*(?:cutting|making|doing|building)/i,
          /(?:50|decades).*years.*(?:experience|cutting|making)/i,
          /master.*makes.*look.*easy/i,
          /effortless/i
        ],
        description: "Showing a master craftsperson making an extremely difficult task appear simple and effortless",
        psychological_trigger: "Fascination with skill levels that transcend normal human capability",
        examples: []
      },
      
      "Specific Dollar Transformation": {
        patterns: [
          /\$[\d,]+.*(?:into|to).*\$[\d,]+/i,
          /\$\d+.*(?:trick|hack).*\$[\d,]+/i,
          /[\d/]+.*acre.*\$[\d,]+/i,
          /\$\d+.*(?:investment|spent).*\$[\d,]+/i
        ],
        description: "Precise dollar amounts showing small investment yielding massive return",
        psychological_trigger: "Concrete proof that specific small actions can create wealth",
        examples: []
      },
      
      "Discarded → High Value": {
        patterns: [
          /(?:discarded|scrap|old|broken|rotten|dried).*(?:log|wood|pallet).*(?:into|to).*(?:swing|table|chair)/i,
          /(?:trash|waste|junk).*(?:into|to).*(?:treasure|beautiful|amazing)/i,
          /(?:old|broken).*(?:into|to).*(?:new|beautiful|valuable)/i,
          /(?:scrap|waste).*(?:into|to).*masterpiece/i
        ],
        description: "Taking literally discarded materials and transforming them into valuable, beautiful objects",
        psychological_trigger: "Hope that hidden value exists everywhere + environmental guilt relief",
        examples: []
      },
      
      "Before Everyone Else Wakes Up": {
        patterns: [
          /before.*breakfast/i,
          /morning.*(?:before|while).*(?:most|everyone|others)/i,
          /while.*(?:you|others).*sleep/i,
          /before.*(?:coffee|sunrise|dawn)/i,
          /early.*morning.*(?:advantage|edge)/i
        ],
        description: "Achieving significant results in the time before normal people start their day",
        psychological_trigger: "Time scarcity anxiety + desire to optimize every moment",
        examples: []
      },
      
      "Professional Industry Secrets Revealed": {
        patterns: [
          /(?:insider|industry|professional).*secrets/i,
          /what.*(?:pros|professionals|experts).*(?:don't.*tell|hide|won't.*share)/i,
          /(?:behind.*scenes|real.*story).*how.*(?:they|professionals)/i,
          /(?:secret|hidden).*(?:techniques|methods).*(?:pros|professionals)/i
        ],
        description: "Exposing closely-guarded knowledge that professionals use but don't share publicly",
        psychological_trigger: "Desire for insider access + resentment toward gatekeeping",
        examples: []
      },
      
      "Impossible Physics Defied": {
        patterns: [
          /no.*motor.*(?:but|yet).*(?:speed|power|fast)/i,
          /without.*(?:electricity|power|fuel).*(?:but|yet).*(?:works|runs)/i,
          /(?:shouldn't|can't).*work.*but.*(?:does|it.*does)/i,
          /defies.*(?:physics|logic|gravity)/i,
          /impossible.*but.*(?:real|true|works)/i
        ],
        description: "Something that appears to violate physical laws or common sense but actually works",
        psychological_trigger: "Fascination with breaking perceived limitations of reality",
        examples: []
      },
      
      "Decode Someone's Exact Method": {
        patterns: [
          /how.*(?:she|he|they).*(?:makes|earns|built).*\$[\d,]+/i,
          /(?:exact|step.*by.*step).*method.*(?:she|he|they).*used/i,
          /breakdown.*how.*(?:she|he|they).*(?:achieved|built|made)/i,
          /(?:behind.*scenes|real.*story).*how.*(?:she|he|they)/i
        ],
        description: "Reverse engineering the exact process someone used to achieve remarkable success",
        psychological_trigger: "Belief that success has a formula that can be copied",
        examples: []
      },
      
      "Ancient Wisdom Applied Modern": {
        patterns: [
          /(?:ancient|traditional|old.*school).*(?:technique|method|secret).*(?:modern|today|2025)/i,
          /(?:grandfather's|father's|traditional).*(?:method|technique|way)/i,
          /(?:centuries|decades).*old.*(?:technique|method|secret)/i,
          /(?:lost|forgotten).*(?:art|technique|method)/i
        ],
        description: "Taking time-tested techniques from the past and applying them to modern problems",
        psychological_trigger: "Nostalgia + belief that old ways were better/more authentic",
        examples: []
      },
      
      "Status Symbol Cost Hacking": {
        patterns: [
          /look.*(?:cheap|poor|amateur)/i,
          /(?:expensive|luxury).*look.*for.*(?:less|\$\d+)/i,
          /(?:avoid|don't).*looking.*(?:cheap|poor|amateur)/i,
          /(?:mistakes|things).*make.*you.*look.*(?:cheap|poor|amateur)/i,
          /(?:professional|expensive).*(?:look|appearance).*(?:cheap|budget)/i
        ],
        description: "Achieving expensive/professional appearance without the typical cost",
        psychological_trigger: "Status anxiety + desire to appear higher class than actual resources allow",
        examples: []
      },
      
      "Forbidden Speed Learning": {
        patterns: [
          /(?:learn|master).*(?:so|too).*fast.*(?:illegal|shouldn't.*be.*possible)/i,
          /(?:speed|rapid|instant).*(?:learning|mastery).*(?:feels|seems).*(?:illegal|impossible)/i,
          /(?:master|learn).*(?:overnight|instantly|in.*(?:days|hours))/i,
          /(?:shortcut|hack).*to.*(?:mastery|expertise|learning)/i
        ],
        description: "Learning complex skills at a speed that feels like cheating or breaking rules",
        psychological_trigger: "Impatience with traditional learning + desire to skip struggle",
        examples: []
      }
    };

    // Analyze each video against each frame
    Object.entries(frames).forEach(([frameName, frameData]) => {
      videos.forEach(video => {
        const combinedText = `${video.title} ${video.llm_summary || ''}`;
        
        // Check if any pattern matches
        const matches = frameData.patterns.some(pattern => pattern.test(combinedText));
        
        if (matches) {
          frameData.examples.push({
            title: video.title,
            score: parseFloat(video.performance_score),
            niche: video.topic_niche,
            video_id: video.video_id,
            summary: video.llm_summary
          });
        }
      });
    });

    // Filter frames with at least 6 examples and sort by average performance
    const significantFrames = Object.entries(frames)
      .filter(([_, data]) => data.examples.length >= 6)
      .map(([name, data]) => ({
        name,
        description: data.description,
        psychological_trigger: data.psychological_trigger,
        count: data.examples.length,
        avgScore: data.examples.reduce((sum, ex) => sum + ex.score, 0) / data.examples.length,
        examples: data.examples.sort((a, b) => b.score - a.score),
        niches: [...new Set(data.examples.map(ex => ex.niche))].length
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    console.log('🎯 Ultra-Specific Psychological Frames (6+ examples):');
    console.log('====================================================\n');

    significantFrames.forEach(frame => {
      console.log(`🔥 ${frame.name} (${frame.count} videos, ${frame.avgScore.toFixed(1)}x avg)`);
      console.log(`   Description: ${frame.description}`);
      console.log(`   Psychological Trigger: ${frame.psychological_trigger}`);
      console.log(`   Across ${frame.niches} different niches`);
      console.log(`   Supporting Videos:`);
      
      // Show all examples with explanations
      frame.examples.forEach((example, i) => {
        console.log(`     ${i+1}. ${example.score}x: "${example.title}" (${example.niche})`);
        if (example.summary) {
          console.log(`        Why it supports: ${example.summary.substring(0, 200)}...`);
        }
      });
      console.log('');
    });

    // Create Idea Heist style document
    const ideaHeistDoc = createIdeaHeistDocument(significantFrames);

    // Save both analyses
    const timestamp = new Date().toISOString().split('T')[0];
    const analysisPath = path.join(path.dirname(__dirname), 'exports', `ultra-specific-frame-analysis-${timestamp}.json`);
    const docPath = path.join(path.dirname(__dirname), 'exports', `idea-heist-frames-${timestamp}.md`);
    
    await fs.writeFile(analysisPath, JSON.stringify({
      metadata: {
        total_videos: videos.length,
        frames_found: significantFrames.length,
        analysis_date: new Date().toISOString()
      },
      frames: significantFrames
    }, null, 2));

    await fs.writeFile(docPath, ideaHeistDoc);
    
    console.log(`✅ Ultra-specific frame analysis saved to: ${path.basename(analysisPath)}`);
    console.log(`✅ Idea Heist style document saved to: ${path.basename(docPath)}`);

  } catch (error) {
    console.error('❌ Error analyzing ultra-specific frames:', error);
    process.exit(1);
  }
}

function createIdeaHeistDocument(frames) {
  let doc = `# Viral Content Frames - May-June 2025 Analysis\n\n`;
  doc += `Based on analysis of 1,259 outlier videos (3x+ performance) from May-June 2025.\n\n`;
  
  frames.forEach((frame, index) => {
    doc += `## Frame ${index + 1}: "${frame.name}"\n\n`;
    doc += `**Pattern Description:** ${frame.description}\n\n`;
    doc += `**Psychological Trigger:** ${frame.psychological_trigger}\n\n`;
    doc += `**Performance:** ${frame.count} videos, ${frame.avgScore.toFixed(1)}x average performance\n\n`;
    doc += `**Cross-Niche Validation:** Appears across ${frame.niches} different niches\n\n`;
    doc += `**Key Elements:**\n`;
    
    // Extract key elements from top performers
    if (frame.name.includes("Master Makes Complex")) {
      doc += `- Master craftsperson with decades of experience\n`;
      doc += `- Extremely difficult task made to look simple\n`;
      doc += `- "Just" or "simply" language minimizing complexity\n`;
      doc += `- Visual evidence of effortless execution\n`;
    } else if (frame.name.includes("Specific Dollar")) {
      doc += `- Exact small dollar amount (under $100)\n`;
      doc += `- Exact large dollar return (thousands+)\n`;
      doc += `- Clear mathematical relationship\n`;
      doc += `- Concrete proof of transformation\n`;
    } else if (frame.name.includes("Discarded")) {
      doc += `- Literally discarded/waste materials\n`;
      doc += `- Beautiful, valuable end product\n`;
      doc += `- Clear before/after transformation\n`;
      doc += `- Environmental responsibility angle\n`;
    } else if (frame.name.includes("Before Everyone")) {
      doc += `- Specific early morning timeframe\n`;
      doc += `- Significant accomplishment achieved\n`;
      doc += `- Contrast with "normal" people's schedules\n`;
      doc += `- Time optimization angle\n`;
    }
    
    doc += `\n**Supporting Videos:**\n\n`;
    
    frame.examples.forEach((example, i) => {
      doc += `${i + 1}. **${example.score}x Performance**: "${example.title}" (${example.niche})\n`;
      doc += `   - **Why it works**: `;
      
      if (frame.name.includes("Master Makes Complex")) {
        if (example.title.includes("Carpenter")) {
          doc += `50-year master carpenter makes precision cutting look like a casual everyday task\n`;
        } else if (example.title.includes("Pool Cleaner")) {
          doc += `Advanced robot technology makes pool maintenance completely effortless\n`;
        } else {
          doc += `Expert-level skill demonstrated with apparent ease\n`;
        }
      } else if (frame.name.includes("Specific Dollar")) {
        if (example.title.includes("$2.75")) {
          doc += `Tiny $2.75 investment solves major workshop problem worth thousands\n`;
        } else if (example.title.includes("1/8 Acre")) {
          doc += `Impossibly small plot generates massive income through smart farming\n`;
        } else {
          doc += `Concrete dollar transformation demonstrates scalable wealth creation\n`;
        }
      } else if (frame.name.includes("Discarded")) {
        if (example.title.includes("Log")) {
          doc += `Worthless discarded log becomes beautiful, functional furniture\n`;
        } else if (example.title.includes("Pallet")) {
          doc += `Industrial waste pallets transformed into attractive home furnishing\n`;
        } else {
          doc += `Waste material given new life as valuable object\n`;
        }
      } else if (frame.name.includes("Before Everyone")) {
        if (example.title.includes("Before Breakfast")) {
          doc += `Generates substantial monthly income before most people start their day\n`;
        } else {
          doc += `Significant accomplishment achieved during typically unproductive time\n`;
        }
      } else {
        doc += `Demonstrates the core psychological trigger effectively\n`;
      }
      doc += `\n`;
    });
    
    doc += `**Semantic Search Queries:**\n`;
    
    if (frame.name.includes("Master Makes Complex")) {
      doc += `- "master craftsman effortless skill"\n`;
      doc += `- "decades experience simple technique"\n`;
      doc += `- "just cutting precision mastery"\n`;
    } else if (frame.name.includes("Specific Dollar")) {
      doc += `- "small investment massive return dollars"\n`;
      doc += `- "exact amount wealth transformation"\n`;
      doc += `- "tiny cost huge profit specific"\n`;
    } else if (frame.name.includes("Discarded")) {
      doc += `- "discarded materials valuable transformation"\n`;
      doc += `- "waste to treasure upcycling"\n`;
      doc += `- "trash into beautiful furniture"\n`;
    } else if (frame.name.includes("Before Everyone")) {
      doc += `- "before breakfast achievement income"\n`;
      doc += `- "early morning productivity advantage"\n`;
      doc += `- "while others sleep accomplishment"\n`;
    }
    
    doc += `\n**Transferability:**\n`;
    doc += `This frame can be applied to any niche by showing `;
    
    if (frame.name.includes("Master Makes Complex")) {
      doc += `a master practitioner making extremely difficult tasks appear effortless through decades of skill development.\n\n`;
    } else if (frame.name.includes("Specific Dollar")) {
      doc += `concrete small investments that yield disproportionately large financial returns with specific dollar amounts.\n\n`;
    } else if (frame.name.includes("Discarded")) {
      doc += `the transformation of literally discarded or waste materials into valuable, beautiful, or functional objects.\n\n`;
    } else if (frame.name.includes("Before Everyone")) {
      doc += `significant achievements accomplished during early morning hours before normal schedules begin.\n\n`;
    }
    
    doc += `---\n\n`;
  });
  
  return doc;
}

// Run the analysis
analyzeUltraSpecificFrames();
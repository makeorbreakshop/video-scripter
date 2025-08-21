import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createEmbeddings } from '@/lib/server/openai-embeddings';
import { getOpenAIApiKey, isPgvectorEnabled } from '@/lib/env-config';

/**
 * API route for running Skyscraper Analysis on a YouTube video
 * 
 * POST /api/skyscraper/analyze
 * 
 * Request Body:
 * {
 *   videoId: string,     // YouTube video ID to analyze
 *   userId: string,      // User ID for data access
 *   phase?: number       // Optional: Specific phase to run (1-5), defaults to next incomplete phase
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   videoId: string,
 *   phase: number,       // The phase that was processed
 *   completedPhases: number[],  // Array of completed phase numbers
 *   isComplete: boolean  // Whether all phases are complete
 * }
 */
export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    // Check if pgvector is enabled (required for embeddings)
    if (!isPgvectorEnabled()) {
      return NextResponse.json(
        { error: 'Vector database functionality is disabled' },
        { status: 400 }
      );
    }
    
    // Parse request body
    const { videoId, userId, phase: requestedPhase } = await request.json();
    
    // Validate required parameters
    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 API: Starting Skyscraper Analysis for video ${videoId}`);
    
    // Get the video metadata
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();
      
    if (videoError || !videoData) {
      console.error(`🚨 API: Video not found for ID ${videoId}:`, videoError);
      return NextResponse.json(
        { error: 'Video not found in database' },
        { status: 404 }
      );
    }
    
    // Get existing analyses for this video to determine which phase to run
    const { data: existingAnalyses, error: analysesError } = await supabase
      .from('analyses')
      .select('phase')
      .eq('video_id', videoId)
      .eq('user_id', userId);
      
    if (analysesError) {
      console.error(`🚨 API: Error fetching existing analyses:`, analysesError);
      return NextResponse.json(
        { error: 'Failed to fetch existing analyses' },
        { status: 500 }
      );
    }
    
    // Determine which phases are already complete
    const completedPhases = existingAnalyses ? existingAnalyses.map(a => a.phase) : [];
    
    // Determine which phase to run
    let phaseToRun: number = 1; // Default to phase 1
    
    if (requestedPhase && requestedPhase >= 1 && requestedPhase <= 5) {
      // If a specific phase was requested, use that
      phaseToRun = requestedPhase;
    } else {
      // Otherwise, find the next incomplete phase
      for (let i = 1; i <= 5; i++) {
        if (!completedPhases.includes(i)) {
          phaseToRun = i;
          break;
        }
      }
      
      // If all phases are complete, re-run phase 1
      if (!phaseToRun) {
        phaseToRun = 1;
      }
    }
    
    console.log(`📊 API: Running Skyscraper Analysis phase ${phaseToRun} for video ${videoId}`);
    
    // Get the video chunks for analysis
    const { data: chunks, error: chunksError } = await supabase
      .from('chunks')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .order('start_time', { ascending: true });
      
    if (chunksError || !chunks || chunks.length === 0) {
      console.error(`🚨 API: No chunks found for video ${videoId}:`, chunksError);
      return NextResponse.json(
        { error: 'No content chunks found for this video' },
        { status: 404 }
      );
    }
    
    // Get the appropriate prompt for this phase
    const prompt = getSkyscraperPrompt(phaseToRun, {
      videoTitle: videoData.title,
      channelName: videoData.channel_id
    });
    
    // For demo purposes, we're simulating the analysis
    // In a production app, you would call Claude or another LLM here
    
    // Simulate the analysis content
    const analysisContent = await simulateAnalysis(phaseToRun, chunks, videoData);
    
    // Generate embedding for the analysis for vector search
    const openaiApiKey = getOpenAIApiKey();
    let embedding = null;
    
    if (openaiApiKey) {
      try {
        const embeddings = await createEmbeddings([analysisContent], openaiApiKey);
        if (embeddings && embeddings.length > 0) {
          embedding = embeddings[0];
        }
      } catch (error) {
        console.warn(`⚠️ API: Failed to generate embedding for analysis, continuing without it:`, error);
      }
    }
    
    // Store the analysis in the database
    // If this phase was already analyzed, update it, otherwise insert a new record
    const existingPhase = completedPhases.includes(phaseToRun);
    let analysisResult;
    
    if (existingPhase) {
      // Update existing analysis
      const { data, error } = await supabase
        .from('analyses')
        .update({
          content: analysisContent,
          embedding: embedding,
          updated_at: new Date().toISOString()
        })
        .eq('video_id', videoId)
        .eq('phase', phaseToRun)
        .eq('user_id', userId)
        .select()
        .single();
        
      if (error) {
        console.error(`🚨 API: Error updating analysis:`, error);
        return NextResponse.json(
          { error: 'Failed to update analysis' },
          { status: 500 }
        );
      }
      
      analysisResult = data;
    } else {
      // Insert new analysis
      const { data, error } = await supabase
        .from('analyses')
        .insert({
          video_id: videoId,
          phase: phaseToRun,
          content: analysisContent,
          embedding: embedding,
          metadata: {
            prompt: prompt
          },
          user_id: userId
        })
        .select()
        .single();
        
      if (error) {
        console.error(`🚨 API: Error inserting analysis:`, error);
        return NextResponse.json(
          { error: 'Failed to save analysis' },
          { status: 500 }
        );
      }
      
      analysisResult = data;
      completedPhases.push(phaseToRun);
    }
    
    // If this was phase 5, also generate and store patterns
    if (phaseToRun === 5) {
      try {
        // In production, you'd extract structured data from the phase 5 output
        const patternData = {
          hookType: "Question Hook",
          structureType: "Problem-Solution-Result",
          engagementTechniques: ["Personal stories", "Visual metaphors", "Unexpected facts"]
        };
        
        // Store the pattern
        await supabase
          .from('patterns')
          .upsert({
            video_id: videoId,
            pattern_type: 'video_structure',
            pattern_data: patternData,
            user_id: userId
          }, {
            onConflict: 'video_id,pattern_type,user_id'
          });
          
        console.log(`✅ API: Saved pattern data for video ${videoId}`);
      } catch (error) {
        // Don't fail the whole request if pattern extraction fails
        console.error(`⚠️ API: Error extracting/storing patterns:`, error);
      }
    }
    
    console.log(`✅ API: Completed Skyscraper Analysis phase ${phaseToRun} for video ${videoId}`);
    
    // Return success with the phase that was processed
    return NextResponse.json({
      success: true,
      videoId,
      phase: phaseToRun,
      completedPhases: [...new Set(completedPhases)].sort(),
      isComplete: new Set(completedPhases).size >= 5
    });
    
  } catch (error) {
    console.error('🚨 API: Error in Skyscraper Analysis endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

/**
 * Get the appropriate prompt for a Skyscraper Analysis phase
 */
function getSkyscraperPrompt(phase: number, context: { videoTitle: string, channelName: string }): string {
  const { videoTitle, channelName } = context;
  
  const promptTemplates = [
    // Phase 1: Initial Discovery & Structure
    `I'm analyzing this YouTube video "${videoTitle}" by ${channelName} using the Skyscraper method. Please examine this transcript and comments to answer:

1. What is the overall structure and flow of this video? Identify all major sections, their approximate timestamps, and how they connect.

2. Analyze the intro/hook (first 30-60 seconds):
   - What technique does it use to grab attention?
   - How does it establish the problem or promise?
   - What makes it particularly effective or ineffective?

3. Map the core content structure:
   - What are the main points or sections?
   - How does the creator transition between sections?
   - What storytelling techniques or frameworks are employed?

4. Examine the ending and call-to-action:
   - How does the video conclude?
   - What specific CTA techniques are used?
   - How does it set up future engagement?

Please format your analysis with clear headings and concise bullet points.`,

    // Phase 2: Audience Response & Engagement
    `For the YouTube video "${videoTitle}" by ${channelName}, please examine the viewer comments to answer:

1. Audience reception patterns:
   - What specific elements do viewers mention positively?
   - What moments/points generated the most discussion?
   - Are there common phrases or sentiments that appear repeatedly?

2. Content gap analysis:
   - What questions are viewers asking that weren't addressed?
   - What related topics do they want to learn more about?
   - What confusion points are evident in the comments?

3. Engagement triggers:
   - Which specific moments seemed to create strong emotional reactions?
   - What information did viewers find most valuable or surprising?
   - What content did they share or mention wanting to share?

4. Audience profile insights:
   - What can you infer about the audience from their comments?
   - What skill levels, pain points, and goals are represented?
   - How does the content align with these audience characteristics?`,

    // Phase 3: Performance Analysis & Strategic Elements
    `For the YouTube video "${videoTitle}" by ${channelName}, please analyze the strategic elements that likely contributed to its performance:

1. Title and hook alignment:
   - How does the hook deliver on the title's promise?
   - What specific techniques make the title-hook combination effective?
   - How quickly does the video validate the viewer's click?

2. Retention strategy analysis:
   - What techniques does the creator use to maintain interest?
   - Where might viewers be most likely to drop off?
   - What "pattern interrupts" or engagement spikes occur throughout?

3. Content differentiation:
   - What makes this treatment of the topic unique?
   - How does it improve upon or differ from standard approaches?
   - What credibility elements or unique perspectives are presented?

4. Positioning and framing:
   - How is the content framed to seem valuable/novel/important?
   - What psychological principles are leveraged (FOMO, curiosity, etc.)?
   - How does the creator establish authority on this topic?`,

    // Phase 4: Actionable Implementation Plan
    `Based on all previous analyses of the video "${videoTitle}" by ${channelName}, please create an actionable implementation plan:

1. Transferable elements:
   - Which specific techniques from this video could I adapt for my content?
   - What 3 structural elements were most effective and worth emulating?
   - How could I improve upon their approach to this topic?

2. Content blueprint:
   - Create a detailed outline for a new video on this topic that builds upon these strengths
   - Include specific hook options, section structure, and example/story placements
   - Suggest transitions between sections based on effective patterns

3. Script guidance:
   - Provide specific language examples for crucial moments (hook, transitions, CTA)
   - Suggest how to address the content gaps identified in viewer comments
   - Recommend frameworks for presenting complex information based on what worked

4. Performance optimization:
   - What thumbnail elements would best represent this content?
   - Suggest 5 title variations using patterns from successful videos
   - Recommend timing/pacing improvements based on engagement analysis`,

    // Phase 5: Pattern Repository Entry
    `I'm building a pattern library of successful YouTube techniques. Please format your analysis of the video "${videoTitle}" by ${channelName} into the following template:

1. VIDEO METADATA
   - Title: ${videoTitle}
   - Creator: ${channelName}
   - Niche/Category:
   - Key Metrics (if available):

2. STRUCTURAL PATTERN
   - Primary Structure Type:
   - Section Breakdown (with percentages):
   - Content Elements Used:
   - Unique Structural Innovations:

3. HOOK STRATEGY
   - Hook Type:
   - Hook Duration:
   - Key Hook Components:
   - Hook-to-Content Transition Method:

4. ENGAGEMENT TECHNIQUES
   - Primary Storytelling Method:
   - Example/Demonstration Approach:
   - Visual Support Strategy:
   - Audience Interaction Methods:

5. CONTENT POSITIONING
   - Value Proposition:
   - Credibility Establishment Method:
   - Problem Framing Approach:
   - Differentiating Factors:

6. AUDIENCE RESPONSE SUMMARY
   - Most Positively Received Elements:
   - Identified Content Gaps:
   - Engagement Trigger Points:
   - Follow-up Opportunities:

Format this as a structured entry that I can easily reference and compare with other videos.`
  ];
  
  // Get the prompt for the requested phase (1-indexed)
  return promptTemplates[phase - 1] || promptTemplates[0];
}

/**
 * Simulate an analysis for demo purposes
 * In production, this would be replaced with a call to Claude or another LLM
 */
async function simulateAnalysis(phase: number, chunks: any[], videoData: any): Promise<string> {
  // For demo purposes, simulate different analyses based on the phase
  const phaseContent = [
    // Phase 1: Initial Discovery & Structure
    `# Structural Analysis of "${videoData.title}"

## Overall Structure and Flow

The video follows a clear Problem-Solution-Implementation structure:

* **Introduction (0:00-1:45)**: Hooks viewers with a relatable problem and promises a solution
* **Main Content (1:46-8:30)**: Presents a framework with 3 distinct techniques
* **Examples (8:31-12:15)**: Demonstrates each technique with real-world applications
* **Implementation (12:16-14:20)**: Provides step-by-step guidance for viewers
* **Conclusion (14:21-15:30)**: Summarizes key points and includes call-to-action

## Intro/Hook Analysis

* **Attention-grabbing technique**: Opens with a provocative question that challenges conventional wisdom
* **Problem establishment**: Uses statistics to validate the problem's significance and universality
* **Effectiveness factors**:
  - Creates immediate emotional connection through shared frustration
  - Sets up clear stakes and consequences of not solving the problem
  - Transitions seamlessly from problem to promise of solution

## Core Content Structure

* **Main points**:
  - Technique 1: Conceptual framework
  - Technique 2: Practical application
  - Technique 3: Common pitfalls and how to avoid them
  
* **Transition methods**:
  - Uses bridging statements that connect previous point to upcoming section
  - Employs visual transitions with clear section headings
  - Maintains narrative thread throughout different sections
  
* **Storytelling frameworks**:
  - Hero's journey structure applied to viewer's experience
  - Before/after contrast to highlight transformation
  - Rule of three for main techniques (enhances memorability)

## Ending and Call-to-Action

* **Conclusion style**: Circular reference back to opening problem with newfound solution
* **CTA techniques**:
  - Primary: Subscribe prompt with specific value proposition
  - Secondary: Community engagement question for comments
  - Supplementary: Related video recommendation
  
* **Future engagement setup**:
  - Teases upcoming related content
  - Suggests progression path for viewers to continue learning
  - Creates open loop that can only be closed by subscribing

This video demonstrates excellent structural coherence with clear transitions between logically organized sections, making it easy for viewers to follow and extract value.`,

    // Phase 2: Audience Response & Engagement
    `# Audience Response Analysis for "${videoData.title}"

## Audience Reception Patterns

* **Positively mentioned elements**:
  - The "3-step framework" received overwhelming praise (mentioned in 47% of comments)
  - Visual diagrams and examples highly appreciated for clarity
  - Many viewers specifically thanked the creator for avoiding fluff/filler content
  
* **Most discussed moments**:
  - The counterintuitive insight at 4:32 generated significant discussion
  - The practical example at 9:15 received many timestamps in comments
  - The creator's personal anecdote at 2:45 prompted viewers to share their similar experiences
  
* **Common phrases/sentiments**:
  - "Finally someone explained this clearly"
  - "This changed my perspective on [topic]"
  - "Using this technique immediately in my work"

## Content Gap Analysis

* **Unanswered questions**:
  - How to apply these techniques in [specific industry context]
  - Whether these approaches work in international/cultural contexts
  - How to measure success metrics after implementation
  
* **Requested related topics**:
  - Advanced variations of the techniques
  - Software tools that complement the methodology
  - Case studies from recognized brands/companies
  
* **Evident confusion points**:
  - The distinction between Technique 2 and 3 wasn't clear to newer viewers
  - Some viewers were uncertain about prerequisite knowledge
  - A few requested clarification on terminology used around 7:30

## Engagement Triggers

* **Strong emotional reactions**:
  - Revelation moment at 6:20 ("mind blown" comments)
  - Relatability of common mistake example at 10:45
  - Humor element at 13:10 consistently mentioned positively
  
* **Most valuable information**:
  - The downloadable resource mentioned
  - The shortcut technique explained at 11:35
  - The comparison table showing different approaches
  
* **Shared/sharable content**:
  - Many comments about sharing with teams/colleagues
  - Several mentions of taking screenshots of key frameworks
  - Multiple requests to share the video in professional groups

## Audience Profile Insights

* **Skill level distribution**:
  - Primarily intermediate practitioners (familiar with basics but seeking optimization)
  - Some beginners looking for fundamental guidance
  - Advanced viewers validating their existing approaches
  
* **Common pain points**:
  - Time constraints in implementation
  - Previous failures with similar methods
  - Resistance from stakeholders/teams
  
* **Goals represented**:
  - Improving efficiency in current workflows
  - Gaining competitive advantage in their field
  - Teaching/transferring knowledge to others

Overall, the audience appears highly engaged with practical, implementation-focused content that provides clear frameworks and actionable steps, while appreciating the creator's straightforward communication style.`,

    // Phase 3: Performance Analysis & Strategic Elements
    `# Strategic Performance Analysis for "${videoData.title}"

## Title and Hook Alignment

* **Promise delivery efficiency**:
  - Hook directly addresses the title's promise within the first 35 seconds
  - Uses "proof of concept" mini-example at 1:20 to validate title claim
  - Creates clear "before vs. after" contrast to demonstrate value
  
* **Title-hook effectiveness techniques**:
  - Specific number in title creates concrete expectation (fulfilled in hook)
  - Problem-agitation in hook intensifies need for promised solution
  - Visual preview of end result establishes credibility early
  
* **Click validation speed**:
  - Value proposition confirmed by 0:45 mark
  - Clear roadmap presented by 1:30 mark
  - First actionable insight delivered by 2:15 mark

## Retention Strategy Analysis

* **Interest maintenance techniques**:
  - "Open loops" created throughout (5 identified instances)
  - Progressive revelation of information (simple → complex)
  - Regular pattern of theory → example → application
  
* **Potential drop-off points**:
  - Technical explanation at 5:30 (mitigated by follow-up example)
  - Transition point at 8:45 (bridged with engagement question)
  - Extended section around 11:20 (broken up with visual change)
  
* **Pattern interrupts/engagement spikes**:
  - Unexpected statistic at 3:45
  - Tonal shift/personal story at 7:15
  - Contrarian viewpoint at 9:50
  - Humor element at 12:30

## Content Differentiation

* **Uniqueness factors**:
  - Proprietary framework not commonly found in competitor videos
  - Counter-intuitive approach to standard problem
  - Integration of cross-disciplinary concepts
  
* **Improvement upon standard approaches**:
  - Simplification of typically complex methodology
  - Addition of practical implementation steps often missing in theory-heavy content
  - Addressing common failure points preemptively
  
* **Credibility elements**:
  - Reference to research studies (3:30, 8:15)
  - Mention of relevant experience/background (1:15)
  - Demonstration of results through case examples (10:20, 13:45)

## Positioning and Framing

* **Value/novelty framing**:
  - Positioned as "overlooked" approach (creating discovery effect)
  - Framed as high-leverage technique (small input, large output)
  - Emphasized time-saving benefits throughout
  
* **Psychological principles leveraged**:
  - Curiosity gaps (particularly effective at 2:50, 6:15, 11:30)
  - Social proof (comment highlights, success stories)
  - Scarcity/exclusivity (insider knowledge framing)
  - Cognitive ease (complex ideas simplified through metaphors)
  
* **Authority establishment**:
  - Demonstrated deep knowledge through anticipation of questions/objections
  - Balanced confidence with appropriate hedging where needed
  - Referenced personal results and client outcomes

This video employs sophisticated retention strategies through carefully structured information revelation, regular pattern interrupts, and strong psychological framing to maintain engagement throughout its duration.`,

    // Phase 4: Actionable Implementation Plan
    `# Implementation Plan Based on "${videoData.title}"

## Transferable Elements

* **Key techniques worth adapting**:
  - The "stack-rank-select" prioritization framework (5:30-6:45)
  - The visual comparison matrix for decision-making (9:15-10:30)
  - The objection pre-empting technique throughout the script
  
* **Most effective structural elements**:
  1. Problem description that incorporates viewer's language and pain points
  2. Clear, numbered steps with distinct visual representations
  3. Implementation examples at different expertise levels
  
* **Improvement opportunities**:
  - Add downloadable resource for framework application
  - Integrate more industry-specific examples based on audience segments
  - Include a troubleshooting section addressing common failure points

## Content Blueprint

### Video Outline: "How to [Topic] Using the [Framework] Method"

**Hook Section (0:00-1:30)**
- Open with startling statistic about problem cost/impact
- Share brief personal story of struggle → discovery → transformation
- Preview the 3-part framework with visual overview
- Promise specific outcome with timeline ("In the next 15 minutes...")

**Framework Introduction (1:31-4:00)**
- Explain underlying principles (keep brief, focus on relevance)
- Position against conventional approaches (highlight key differences)
- Overview of the 3 steps with clear definitions
- Set expectations for implementation difficulty and timeline

**Step 1: [First Technique] (4:01-7:00)**
- Detailed explanation with visual support
- Common mistake warning
- Example from recognizable context
- Quick implementation checklist

**Step 2: [Second Technique] (7:01-10:00)**
- Connection to previous step
- Step-by-step breakdown with on-screen text
- Demonstration using worked example
- Before/after comparison

**Step 3: [Third Technique] (10:01-13:00)**
- Integration with previous steps
- Advanced application options
- Case study with concrete results
- Troubleshooting common obstacles

**Implementation Guide (13:01-15:30)**
- Day 1 action plan
- Week 1 expectations
- 30-day progress roadmap
- Success measurement criteria

**Conclusion & CTA (15:31-16:30)**
- Recap key benefits and unique approach
- Address remaining objections
- Specific next video teaser
- Comment prompt tied to viewer's experience

## Script Guidance

**Hook language examples:**
"What if I told you that [common practice] is actually causing [unexpected negative outcome]? In today's video, I'm going to show you why [alternative approach] produces [desired result] in half the time, without [common obstacle]."

**Transition phrases:**
- From problem to solution: "Now that we understand what's broken, let's fix it with this 3-part framework..."
- Between sections: "With [first element] now optimized, let's move to the often overlooked area of [second element]..."
- To examples: "Let me show you exactly how this works with a real-world scenario..."

**CTA approach:**
"Before you implement this framework, I'd love to know: which of the three techniques do you think will make the biggest difference in your specific situation? Share in the comments below, and I'll personally respond with additional customized tips for your context."

## Performance Optimization

**Thumbnail elements:**
- Text: Clear problem/solution statement (5-7 words max)
- Visual: Before/after comparison or result demonstration
- Design: High contrast with bold highlight on key term
- Expression: Interested/surprised facial expression if featuring person

**Title variations:**
1. "The 3-Step [Topic] Framework That Increased My [Result] by [Percentage]"
2. "How to [Desired Outcome] Without [Common Problem] (3-Step Method)"
3. "[Topic] Mastery: The Uncommon Strategy for [Result] in [Timeframe]"
4. "Stop [Common Mistake] - Do This [Alternative] Instead for [Benefit]"
5. "I Tried [Topic] for 30 Days Using This Framework (Here's What Happened)"

**Timing/pacing improvements:**
- Front-load key insights (major takeaway within first 3 minutes)
- Limit each section explanation to maximum 2.5 minutes
- Include engagement question at 5-minute mark
- Use pattern interrupt (tone/visual change) every 3-4 minutes
- Create mini-conclusion after each major section

This implementation plan adapts the most effective elements of the analyzed video while addressing content gaps identified in audience feedback.`,

    // Phase 5: Pattern Repository Entry
    `# Pattern Repository Entry

## VIDEO METADATA
- Title: ${videoData.title}
- Creator: ${videoData.channel_id}
- Niche/Category: Educational/How-To/Professional Development
- Key Metrics (if available): Views trending above channel average, high comment-to-view ratio

## STRUCTURAL PATTERN
- Primary Structure Type: Problem-Solution-Implementation
- Section Breakdown:
  * Introduction/Problem (10%)
  * Framework Overview (15%)
  * Detailed Technique Explanation (40%)
  * Implementation Examples (20%)
  * Results & CTA (15%)
- Content Elements Used:
  * Animated diagrams/charts
  * Talking head with key text overlays
  * Screen recordings for demonstrations
  * Before/after comparisons
- Unique Structural Innovations:
  * "Micro-examples" integrated throughout explanation sections
  * Multiple difficulty levels for implementation (beginner/advanced)
  * Recurring visual motif reinforcing key framework

## HOOK STRATEGY
- Hook Type: Problem-Agitation-Solution
- Hook Duration: 85 seconds
- Key Hook Components:
  * Relatable problem scenario
  * Statistical validation of problem significance
  * "What if" hypothesis challenging conventional wisdom
  * Clear promise with specific outcome
- Hook-to-Content Transition Method:
  * Visual framework preview
  * Content roadmap with timestamp callouts
  * Brief credibility establishment

## ENGAGEMENT TECHNIQUES
- Primary Storytelling Method: Transformation narrative with viewer as protagonist
- Example/Demonstration Approach:
  * Progressive complexity (simple → advanced)
  * Multiple context applications (personal, professional, specialized)
  * Failure-then-success sequencing
- Visual Support Strategy:
  * Consistent color-coding for framework components
  * Progressive build of complex diagrams
  * On-screen text emphasizing key phrases
  * Simplified visuals with focused attention cues
- Audience Interaction Methods:
  * Periodic rhetorical questions
  * Objection acknowledgment and addressing
  * Action prompts with pauses for consideration
  * Specific comment/engagement questions

## CONTENT POSITIONING
- Value Proposition: "A simplified, more effective approach to [topic] that works for beginners and experts"
- Credibility Establishment Method:
  * Results-first approach (showing outcome before explanation)
  * Reference to relevant experience and background
  * Third-party validation (research, expert quotes)
  * Demonstration of deep knowledge through anticipation of questions
- Problem Framing Approach:
  * Universal framing ("everyone struggles with...")
  * Multi-level impact illustration (personal, professional, financial)
  * Common mistake identification with empathetic tone
- Differentiating Factors:
  * Proprietary framework with unique terminology
  * Emphasis on practical implementation vs. theory
  * Comprehensive troubleshooting component
  * Time-efficiency focus throughout

## AUDIENCE RESPONSE SUMMARY
- Most Positively Received Elements:
  * Framework simplicity and memorability
  * Concrete examples across different contexts
  * Actionable implementation guidance
  * Visual explanation style
- Identified Content Gaps:
  * Industry-specific applications
  * Advanced edge cases
  * Integration with other methodologies/tools
  * Measurement of success metrics
- Engagement Trigger Points:
  * Counterintuitive insight at 4:32
  * Surprising statistic at 7:15
  * Relatable anecdote at 9:45
  * Visual demonstration at 12:20
- Follow-up Opportunities:
  * Specialized versions for different industries/contexts
  * Advanced masterclass on complex applications
  * Case study deep-dives on successful implementations
  * Troubleshooting guide for common obstacles

This video follows a highly effective educational pattern with strong emphasis on practical application. The content structure moves seamlessly from problem validation to solution framework to implementation guidance, maintaining engagement through varied delivery methods and strategic information revealing.`
  ];
  
  // Use the appropriate phase content (1-indexed)
  return phaseContent[phase - 1] || "Analysis content not available";
} 
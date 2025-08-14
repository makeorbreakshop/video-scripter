import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Test data from the log
const testVideo = {
    id: "XKrDUnZCmQQ",
    title: "How to Design a Print with Perfect Tolerance EVERY Time",
    channel: "Slant 3D",
    views: 164825,
    performance_score: 17.719,
    baseline: 10162.5,
    thumbnail_url: "https://i.ytimg.com/vi/XKrDUnZCmQQ/hqdefault.jpg",
    niche: "Fashion & Beauty",
    summary: "Designing parts with perfect tolerances for 3D printing by applying proven design principles that ensure a reliable fit regardless of printer, material, or slicer settings. Techniques include creating press-fits, snap-fits, and interlocking components while addressing issues like shrinkage and machine variations through features such as rounded corners and compliant designs."
};

const baselineVideos = [
    { title: "Why Variation is Bad | Multipurpose Machines are a Bad Sign | 3D Printing News | Podcast Ep 115", views: 7594, score: 0.813 },
    { title: "How Parts are Made in a Giant 3D Print Farm", views: 9863, score: 0.875 },
    { title: "Should We Replace Etsy? | Limiting Tangled Orders | Rocket Engines | 3D Printing News Ep 110", views: 11047, score: 0.99 },
    { title: "How We Would Make a Product for Mr. Beast", views: 11651, score: 1.0 }
];

// CURRENT PROMPT (from log)
const currentPrompt = `You are a team of three specialized analysts examining this viral YouTube video and its thumbnail to extract transferable success patterns.

**DESIGN ANALYST**: Focus on visual composition, color theory, typography, layout principles, and aesthetic appeal. Rate the design quality and identify specific design choices that impact performance.

**PSYCHOLOGY ANALYST**: Focus on emotional triggers, cognitive biases, viewer psychology, curiosity gaps, and behavioral responses. Explain why viewers would click based on psychological principles.

**MARKETING ANALYST**: Focus on positioning, competitive differentiation, target audience alignment, trend awareness, and market positioning. Compare to successful content in this niche.

TARGET VIDEO (17.7x performance):
Title: "${testVideo.title}"
Views: ${testVideo.views.toLocaleString()}
Channel: ${testVideo.channel}
Niche: ${testVideo.niche}
Summary: ${testVideo.summary}

CHANNEL BASELINE (normal performers for comparison):
${baselineVideos.map((v, i) => `${i + 1}. "${v.title}" - ${v.views.toLocaleString()} views (${v.score}x)`).join('\n')}

Each analyst should contribute their expertise to identify what makes this video outperform the baseline. The design analyst examines the visual elements, the psychology analyst identifies the emotional triggers, and the marketing analyst explains the competitive positioning.

Return a JSON object with enhanced multi-analyst insights:
{
  "pattern_name": "Short, memorable name (max 5 words)",
  "pattern_description": "One sentence explaining the pattern in simple terms",
  "psychological_trigger": "Core psychological reason viewers click (from psychology analyst)",
  "key_elements": ["Text Element 1", "Text Element 2", "Text Element 3"],
  "visual_elements": ["Visual Element 1", "Visual Element 2", "Visual Element 3"],
  "thumbnail_psychology": "How thumbnail emotion/composition creates click desire (psychology analyst)",
  "design_quality_score": 8.5,
  "design_strengths": ["Design strength 1", "Design strength 2"],
  "marketing_positioning": "How this differentiates from competitors (marketing analyst)",
  "competitive_advantage": "Key advantage over similar content (marketing analyst)",
  "why_it_works": "Multi-faceted explanation combining all three analysts' insights",
  "semantic_queries": ["query 1", "query 2", "query 3"],
  "visual_queries": ["visual pattern 1", "visual pattern 2"],
  "channel_outlier_explanation": "Why this video exploded compared to baseline (all analysts)"
}`;

// IMPROVED PROMPT (based on vision best practices)
const improvedPrompt = `You are a YouTube performance analyst examining why one video dramatically outperformed a channel's baseline using systematic visual analysis.

CONTEXT:
- Channel: Technical 3D printing content (Slant 3D)
- Typical performance: 7K-11K views per video
- Target breakthrough: 164K views (17.7x multiplier)
- Audience: Technical practitioners seeking reliable solutions

TARGET VIDEO ANALYSIS:
Title: "${testVideo.title}"
Performance: ${testVideo.views.toLocaleString()} views (17.7x normal)
Summary: ${testVideo.summary}

BASELINE COMPARISON:
${baselineVideos.map((v, i) => `${i + 1}. "${v.title}" - ${v.views.toLocaleString()} views (${v.score}x)`).join('\n')}

SYSTEMATIC ANALYSIS FRAMEWORK:
Using chain of thought reasoning, analyze the thumbnail step-by-step:

Step 1: VISUAL INVENTORY
Examine the thumbnail's: color psychology, typography choices, composition elements, visual hierarchy, and emotional triggers.

Step 2: BASELINE DIFFERENTIATION  
Compare against typical 3D printing content patterns. What visual elements break the channel's normal format?

Step 3: PSYCHOLOGICAL MECHANISM
Explain the specific psychological principle that makes viewers more likely to click this thumbnail over similar technical content.

Step 4: PATTERN FORMULATION
Synthesize findings into a replicable pattern with clear success factors.

OUTPUT FORMAT:
{
  "visual_inventory": {
    "colors": "Primary colors and their psychological impact",
    "typography": "Text style, size, placement analysis", 
    "composition": "Layout and visual hierarchy description",
    "focal_points": "What draws the eye first, second, third"
  },
  "baseline_differentiation": "How this thumbnail breaks from channel norms",
  "psychological_mechanism": "Why this specific combination triggers more clicks",
  "pattern_name": "Memorable 2-4 word pattern name",
  "pattern_description": "One clear sentence explaining the core principle",
  "success_factors": ["Factor 1", "Factor 2", "Factor 3"],
  "replication_strategy": "How to apply this pattern to similar technical content",
  "confidence_level": "High/Medium/Low with brief justification"
}

VERIFICATION CHECK:
After analysis, confirm your visual observations are actually present in the thumbnail and align with established click-psychology principles.`;

async function getBase64Image(url) {
    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        return base64;
    } catch (error) {
        console.error('Error fetching image:', error);
        return null;
    }
}

async function testPrompt(prompt, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TESTING: ${label}`);
    console.log(`${'='.repeat(60)}`);
    
    const startTime = Date.now();
    
    try {
        // Get thumbnail as base64
        const thumbnailBase64 = await getBase64Image(testVideo.thumbnail_url);
        
        if (!thumbnailBase64) {
            console.log('Failed to fetch thumbnail, testing with text only');
        }

        const messageContent = [];
        
        if (thumbnailBase64) {
            messageContent.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/jpeg",
                    data: thumbnailBase64
                }
            });
        }
        
        messageContent.push({
            type: "text",
            text: prompt
        });

        const response = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            temperature: 0.7,
            messages: [{
                role: "user",
                content: messageContent
            }]
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`⏱️ Completed in ${duration}ms`);
        console.log(`📝 Input tokens: ${response.usage.input_tokens}`);
        console.log(`📝 Output tokens: ${response.usage.output_tokens}`);
        console.log(`💰 Cost: $${((response.usage.input_tokens * 15 + response.usage.output_tokens * 75) / 1000000).toFixed(6)}`);
        
        console.log(`\n📋 RESPONSE:`);
        console.log(response.content[0].text);

        // Try to parse JSON if it looks like JSON
        const responseText = response.content[0].text;
        if (responseText.includes('{') && responseText.includes('}')) {
            try {
                // Extract JSON from response (handle code blocks)
                const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/(\{[\s\S]*\})/);
                if (jsonMatch) {
                    const parsedJson = JSON.parse(jsonMatch[1]);
                    console.log(`\n✅ Successfully parsed JSON response`);
                    console.log(`📊 Pattern name: "${parsedJson.pattern_name || parsedJson.pattern_name || 'N/A'}"`);
                    console.log(`🎯 Main insight: "${parsedJson.pattern_description || parsedJson.baseline_differentiation || 'N/A'}"`);
                }
            } catch (e) {
                console.log(`❌ Could not parse JSON response`);
            }
        }

        return {
            duration,
            tokens: response.usage,
            response: responseText,
            cost: (response.usage.input_tokens * 15 + response.usage.output_tokens * 75) / 1000000
        };

    } catch (error) {
        console.error(`❌ Error testing ${label}:`, error.message);
        return null;
    }
}

async function runComparison() {
    console.log('🧪 PROMPT COMPARISON TEST');
    console.log(`📺 Video: "${testVideo.title}"`);
    console.log(`📈 Performance: ${testVideo.performance_score}x (${testVideo.views.toLocaleString()} views)`);
    console.log(`🖼️ Thumbnail: ${testVideo.thumbnail_url}`);
    
    const currentResult = await testPrompt(currentPrompt, "CURRENT PROMPT (Multi-Agent)");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    const improvedResult = await testPrompt(improvedPrompt, "IMPROVED PROMPT (Vision-Optimized)");
    
    if (currentResult && improvedResult) {
        console.log(`\n${'='.repeat(60)}`);
        console.log('📊 COMPARISON SUMMARY');
        console.log(`${'='.repeat(60)}`);
        console.log(`Current - Duration: ${currentResult.duration}ms | Cost: $${currentResult.cost.toFixed(6)}`);
        console.log(`Improved - Duration: ${improvedResult.duration}ms | Cost: $${improvedResult.cost.toFixed(6)}`);
        console.log(`Speed improvement: ${currentResult.duration > improvedResult.duration ? '✅' : '❌'} ${((currentResult.duration - improvedResult.duration) / currentResult.duration * 100).toFixed(1)}%`);
        console.log(`Cost change: ${currentResult.cost > improvedResult.cost ? '✅ Cheaper' : '❌ More expensive'} by $${Math.abs(currentResult.cost - improvedResult.cost).toFixed(6)}`);
    }
}

runComparison().catch(console.error);
// Test using our existing API endpoint
const testVideo = {
    id: "XKrDUnZCmQQ",
    title: "How to Design a Print with Perfect Tolerance EVERY Time",
    channel: "Slant 3D",
    views: 164825,
    performance_score: 17.719,
    baseline: 10162.5,
    thumbnail_url: "https://i.ytimg.com/vi/XKrDUnZCmQQ/hqdefault.jpg",
    niche: "Fashion & Beauty"
};

async function testCurrentPrompt() {
    console.log('\n🧪 TESTING CURRENT PROMPT (via API)');
    console.log('============================================================');
    
    const startTime = Date.now();
    
    try {
        const response = await fetch('http://localhost:3000/api/analyze-pattern', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                videoId: testVideo.id,
                enhanced: true,
                skipValidation: true  // Skip validation to focus on just pattern extraction
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const duration = Date.now() - startTime;
        
        console.log(`⏱️ Completed in ${duration}ms`);
        console.log(`💰 Cost: $${data.costs?.pattern_extraction || 'N/A'}`);
        
        console.log(`\n📋 CURRENT PATTERN RESULT:`);
        if (data.pattern) {
            console.log(`🏷️ Pattern: "${data.pattern.pattern_name}"`);
            console.log(`📝 Description: "${data.pattern.pattern_description}"`);
            console.log(`🧠 Psychology: "${data.pattern.psychological_trigger}"`);
            console.log(`🎨 Visual Elements: ${JSON.stringify(data.pattern.visual_elements)}`);
            console.log(`📊 Design Score: ${data.pattern.design_quality_score}`);
        }
        
        return {
            duration,
            cost: data.costs?.pattern_extraction || 0,
            pattern: data.pattern
        };
        
    } catch (error) {
        console.error(`❌ Error testing current prompt:`, error.message);
        return null;
    }
}

// Test the improved prompt by creating a custom endpoint
async function testImprovedPrompt() {
    console.log('\n🧪 TESTING IMPROVED PROMPT');  
    console.log('============================================================');
    
    // For now, let's create a simple version manually
    console.log(`📝 IMPROVED PROMPT STRUCTURE:`);
    console.log(`✅ Image-first placement`);
    console.log(`✅ Clear labeling system`);
    console.log(`✅ Chain of thought reasoning`);
    console.log(`✅ Specific analysis framework`);
    console.log(`✅ Context-rich instructions`);
    console.log(`✅ Structured output format`);
    console.log(`✅ Verification requests`);
    
    console.log(`\n📋 IMPROVED PROMPT PREVIEW:`);
    console.log(`"You are a YouTube performance analyst examining why one video dramatically outperformed a channel's baseline using systematic visual analysis.
    
CONTEXT:
- Channel: Technical 3D printing content (Slant 3D)
- Typical performance: 7K-11K views per video
- Target breakthrough: 164K views (17.7x multiplier)
- Audience: Technical practitioners seeking reliable solutions

SYSTEMATIC ANALYSIS FRAMEWORK:
Using chain of thought reasoning, analyze the thumbnail step-by-step:

Step 1: VISUAL INVENTORY - Examine color psychology, typography, composition, hierarchy
Step 2: BASELINE DIFFERENTIATION - What breaks channel norms?  
Step 3: PSYCHOLOGICAL MECHANISM - Why do viewers click this over similar content?
Step 4: PATTERN FORMULATION - Create replicable success factors"...`);
    
    return {
        status: 'conceptual_test',
        improvements: [
            'Systematic step-by-step analysis',
            'Channel-specific context',
            'Visual-first approach', 
            'Clearer output structure',
            'Built-in verification'
        ]
    };
}

async function runComparison() {
    console.log('🧪 PROMPT COMPARISON TEST');
    console.log(`📺 Video: "${testVideo.title}"`);
    console.log(`📈 Performance: ${testVideo.performance_score}x (${testVideo.views.toLocaleString()} views)`);
    console.log(`🖼️ Thumbnail: ${testVideo.thumbnail_url}`);
    
    // Wait for dev server to start
    console.log('\n⏳ Waiting for dev server to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const currentResult = await testCurrentPrompt();
    const improvedResult = await testImprovedPrompt();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 COMPARISON ANALYSIS');
    console.log(`${'='.repeat(60)}`);
    
    if (currentResult) {
        console.log(`✅ Current prompt extracted pattern: "${currentResult.pattern?.pattern_name}"`);
        console.log(`💰 Current cost: $${currentResult.cost}`);
        console.log(`⏱️ Current duration: ${currentResult.duration}ms`);
    }
    
    console.log(`\n🔄 PROPOSED IMPROVEMENTS:`);
    console.log(`1. Replace multi-agent roleplay with systematic step-by-step analysis`);
    console.log(`2. Add channel-specific context for better differentiation`);
    console.log(`3. Use vision best practices (image-first, clear labeling)`);
    console.log(`4. Structure output for actionability`);
    console.log(`5. Include verification step for accuracy`);
    
    console.log(`\n💡 EXPECTED BENEFITS:`);
    console.log(`📈 More focused pattern identification`);
    console.log(`🎯 Better channel-specific insights`);
    console.log(`⚡ Potentially faster processing (simpler structure)`);
    console.log(`✅ Higher accuracy with verification step`);
    console.log(`🔄 More actionable output format`);
}

runComparison().catch(console.error);
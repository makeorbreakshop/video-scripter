import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

async function analyzeRestructuring() {
  // Load the BERTopic mapping
  const topicData = JSON.parse(
    await fs.readFile('./data/bertopic/better_topic_names_v2.json', 'utf-8')
  );
  
  // Group clusters that could share the same niche
  const potentialGroupings = {};
  
  Object.entries(topicData.topics).forEach(([clusterId, info]) => {
    const domain = info.category;
    const currentNiche = info.subcategory;
    const micro = info.name;
    
    // Look for patterns in micro-topic names that suggest they belong together
    // For example: "Woodworking Projects & Tool Reviews" and "Creative Woodworking Ideas" 
    // could both be under "Woodworking"
    
    if (!potentialGroupings[domain]) {
      potentialGroupings[domain] = {};
    }
    
    // Try to identify common themes in micro-topic names
    const keywords = micro.toLowerCase().split(/[\s&,]+/);
    
    // Common niche identifiers
    const nicheKeywords = {
      'Woodworking': ['woodworking', 'wood', 'lumber', 'cabinet', 'furniture', 'joinery'],
      'Programming': ['programming', 'coding', 'development', 'javascript', 'python', 'web'],
      'Fitness': ['fitness', 'workout', 'exercise', 'training', 'gym'],
      'Photography': ['photography', 'photo', 'camera', 'shooting'],
      'Cooking': ['cooking', 'recipe', 'food', 'meal', 'kitchen'],
      'Gaming': ['gaming', 'game', 'gameplay', 'streaming'],
      'Music Production': ['music', 'audio', 'production', 'mixing', 'recording'],
      'Travel': ['travel', 'trip', 'destination', 'tourism', 'adventure'],
      'Business Strategy': ['business', 'entrepreneur', 'startup', 'marketing', 'growth'],
      'Home Improvement': ['home', 'diy', 'renovation', 'repair', 'improvement']
    };
    
    let bestNiche = currentNiche;
    let matchFound = false;
    
    // Check if this topic matches any broader niche category
    for (const [niche, nicheWords] of Object.entries(nicheKeywords)) {
      if (keywords.some(keyword => nicheWords.includes(keyword))) {
        bestNiche = niche;
        matchFound = true;
        break;
      }
    }
    
    if (!potentialGroupings[domain][bestNiche]) {
      potentialGroupings[domain][bestNiche] = [];
    }
    
    potentialGroupings[domain][bestNiche].push({
      clusterId: parseInt(clusterId),
      micro: micro,
      originalNiche: currentNiche
    });
  });
  
  console.log('Potential Restructuring Analysis');
  console.log('================================\n');
  
  // Show domains where we could consolidate niches
  let totalConsolidations = 0;
  
  Object.entries(potentialGroupings).forEach(([domain, niches]) => {
    console.log(`\n${domain}:`);
    
    Object.entries(niches).forEach(([niche, topics]) => {
      if (topics.length > 1) {
        console.log(`  ${niche} (${topics.length} micro-topics):`);
        topics.forEach(topic => {
          console.log(`    - Cluster ${topic.clusterId}: ${topic.micro}`);
          if (topic.originalNiche !== niche) {
            console.log(`      (was: ${topic.originalNiche})`);
          }
        });
        totalConsolidations++;
      }
    });
  });
  
  console.log(`\n\nSummary: Found ${totalConsolidations} potential niche consolidations`);
  
  // Let's specifically look at DIY & Crafts > Woodworking related topics
  console.log('\n\nExample: DIY & Crafts Woodworking-related clusters:');
  console.log('===================================================');
  
  const diyCrafts = topicData.topics;
  const woodworkingRelated = [];
  
  Object.entries(diyCrafts).forEach(([id, info]) => {
    if (info.category === 'DIY & Crafts') {
      const lower = info.name.toLowerCase();
      if (lower.includes('wood') || lower.includes('furniture') || lower.includes('cabinet') || 
          lower.includes('joinery') || lower.includes('lumber')) {
        woodworkingRelated.push({
          id: parseInt(id),
          niche: info.subcategory,
          micro: info.name
        });
      }
    }
  });
  
  console.log('Current structure (each cluster has its own niche):');
  woodworkingRelated.forEach(item => {
    console.log(`  Cluster ${item.id}: DIY & Crafts > ${item.niche} > ${item.micro}`);
  });
  
  console.log('\nProposed structure (multiple micro-topics per niche):');
  console.log('  DIY & Crafts > Woodworking:');
  woodworkingRelated.forEach(item => {
    console.log(`    - Cluster ${item.id}: ${item.micro}`);
  });
}

analyzeRestructuring().catch(console.error);
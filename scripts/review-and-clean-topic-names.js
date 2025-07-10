#!/usr/bin/env node

/**
 * Review and Clean Topic Names
 * Creates a cleaner, more concise version of the topic names for review
 */

import fs from 'fs';

const cleanTopicNames = {
  // Level 1 - Broad Domains (cleaned)
  1: {
    0: "3D Printing & Design",
    1: "Business & Finance", 
    2: "Furniture Making",
    3: "Camera & Video Tech",
    4: "Cosplay & Props",
    5: "Laser Engraving",
    6: "Power Tools & Saws",
    7: "Food & Cooking",
    8: "Fitness & Exercise", 
    9: "Home Installation & Tiling",
    10: "Science Projects",
    11: "Woodworking",
    12: "Coffee Tables", // Duplicate of furniture - should review
    13: "Guitar Building",
    14: "Maker Show Episodes", // Hotmakes
    15: "Epoxy & Resin Work",
    16: "Chair Making",
    17: "Home Renovation",
    18: "Lighting & LEDs",
    19: "AI & Tech News",
    20: "CNC & Drill Tools",
    21: "Knife Making",
    22: "Cabinet Making",
    23: "Ring Making & Jewelry",
    24: "Tool Reviews",
    25: "Drywall & Home Repair",
    26: "Painting & Finishing",
    27: "Door & Window Work",
    28: "Pallet Wood Projects", 
    29: "Vlogging",
    30: "General Furniture", // Another furniture duplicate
    31: "Garden Planters",
    32: "Gardening",
    33: "Bed Building",
    34: "Welding & Metalwork",
    35: "Desk & Office Setup",
    36: "Workbench Building",
    37: "Clamps & Jigs",
    38: "Shop Tours",
    [-1]: "Uncategorized"
  },
  
  // Level 2 - Sample of cleaner niche names
  2: {
    0: "Cooking Recipes",
    1: "Laser Engraving",
    2: "Home Gym Setup", 
    3: "Woodworking Projects",
    4: "Life & Career Content",
    5: "3D Printing",
    6: "Dining Table Making",
    7: "Coffee Table Building",
    8: "Guitar Building",
    9: "Bathroom Projects",
    10: "AI News & Tools",
    // ... would continue for all 181 topics
  },
  
  // Level 3 - Sample of cleaner micro names  
  3: {
    0: "Laser Engraving Projects",
    1: "Cooking Techniques",
    2: "Harbor Freight Tool Reviews",
    3: "3D Printing Tips",
    4: "Ring Making",
    5: "Drywall Repair",
    6: "Bed Design",
    7: "Painting Techniques", 
    8: "AI News Updates",
    9: "Office Setup",
    // ... would continue for all 557 topics
  }
};

function generateCleanedSQL() {
  console.log('📝 Generating cleaned topic names for review...\n');
  
  // Show Level 1 topics for review
  console.log('🎯 Level 1 - Broad Domains (39 topics):');
  console.log('==========================================');
  
  const level1Topics = Object.entries(cleanTopicNames[1])
    .filter(([id]) => id !== '-1')
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    
  for (const [id, name] of level1Topics) {
    console.log(`Topic ${id.padStart(2)}: ${name}`);
  }
  
  console.log('\n🔍 Issues to Review:');
  console.log('- Topic 2 & 12 & 30: Multiple furniture categories (could consolidate)');
  console.log('- Some names are very specific vs broad (Ring Making in Level 1?)');
  console.log('- "Maker Show Episodes" - might be too channel-specific');
  
  console.log('\n💡 Suggestions:');
  console.log('- Consolidate furniture topics into "Furniture & Tables"');
  console.log('- Move very specific topics down a level');
  console.log('- Keep Level 1 to ~12 main categories as originally planned');
  
  return cleanTopicNames;
}

function showTopicDistribution() {
  console.log('\n📊 Topic Distribution Analysis:');
  console.log('Level 1: 39 topics (target was 8-12) - TOO GRANULAR');
  console.log('Level 2: 181 topics (target was 50-100) - REASONABLE');  
  console.log('Level 3: 557 topics (target was 200-500) - REASONABLE');
  
  console.log('\n💭 Recommendations:');
  console.log('1. Consider re-running Level 1 with more aggressive clustering');
  console.log('2. Or manually group similar Level 1 topics into broader categories');
  console.log('3. Current Level 1 is more like "Level 1.5" - between domains and niches');
}

// Run the analysis
generateCleanedSQL();
showTopicDistribution();

console.log('\n❓ What would you like to do?');
console.log('A) Use current names as-is (they\'re detailed but functional)');
console.log('B) Manually consolidate Level 1 into ~12 broader categories'); 
console.log('C) Re-run BERTopic with more aggressive Level 1 clustering');
console.log('D) Review specific problematic names and fix individually');
#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Load all comments
const commentsPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.json');
const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));

console.log(`\n🔍 COMPREHENSIVE CUSTOMER AVATAR ANALYSIS`);
console.log(`📊 Analyzing ${comments.length} quality comments from Make or Break Shop\n`);

// ============================================
// LAYER 1: FOUNDATION ANALYSIS (What + Who)
// ============================================

console.log(`═══════════════════════════════════════════`);
console.log(`LAYER 1: FOUNDATION ANALYSIS`);
console.log(`═══════════════════════════════════════════\n`);

// Pass 1: Demographic & Context Extraction
console.log(`📍 PASS 1: Demographic & Context Extraction`);
console.log(`────────────────────────────────────────`);

const contextPatterns = {
  lifeContext: {
    garage: /\b(garage|shop|workshop|basement|shed)\b/i,
    business: /\b(business|company|customers?|clients?|orders?|selling|commercial)\b/i,
    hobby: /\b(hobby|hobbyist|weekend|spare time|fun|personal projects?)\b/i,
    kids: /\b(kids?|children|son|daughter|family)\b/i,
    work: /\b(at work|office|job|workplace|coworker)\b/i,
    home: /\b(home|house|apartment|room|space)\b/i,
  },
  equipment: {
    hasGlowforge: /\b(have a glowforge|own a glowforge|my glowforge|bought a glowforge)\b/i,
    hasXtool: /\b(have an? xtool|own an? xtool|my xtool|bought an? xtool)\b/i,
    hasOmtech: /\b(have an? omtech|own an? omtech|my omtech)\b/i,
    has3DPrinter: /\b(3d print|printer|ender|prusa|bambu)\b/i,
    hasCNC: /\b(cnc|router|mill|genmitsu|shapeoko)\b/i,
    multipleMachines: /\b(machines|tools|equipment|lasers|cutters)\b/i,
  },
  experience: {
    beginner: /\b(beginner|new to|first time|just starting|learning|newbie|novice)\b/i,
    intermediate: /\b(been doing|for a year|some experience|getting better)\b/i,
    advanced: /\b(years of experience|professional|expert|veteran|long time)\b/i,
    businessOwner: /\b(my business|run a|own a|started a company)\b/i,
  },
  geographic: {
    usa: /\b(USA|United States|America|dollars?|\$)/i,
    uk: /\b(UK|Britain|pounds?|£)/i,
    canada: /\b(Canada|CAD|C\$)/i,
    australia: /\b(Australia|AUD|A\$)/i,
    europe: /\b(Europe|EU|EUR|€)/i,
  }
};

const contextResults = {};
Object.keys(contextPatterns).forEach(category => {
  contextResults[category] = {};
  Object.keys(contextPatterns[category]).forEach(pattern => {
    const matches = comments.filter(c => contextPatterns[category][pattern].test(c.comment_text));
    contextResults[category][pattern] = matches.length;
  });
});

console.log(`\n🏠 Life Context:`);
Object.entries(contextResults.lifeContext).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

console.log(`\n🔧 Equipment Ownership:`);
Object.entries(contextResults.equipment).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

console.log(`\n📈 Experience Levels:`);
Object.entries(contextResults.experience).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

// Pass 2: Explicit Needs Cataloging
console.log(`\n📋 PASS 2: Explicit Needs Cataloging`);
console.log(`────────────────────────────────────────`);

const needsPatterns = {
  goals: {
    wantTo: /\b(I want to|I need to|I'm trying to|looking to|hoping to)\b/gi,
    planning: /\b(planning to|going to|will be|considering|thinking about)\b/gi,
    researching: /\b(researching|comparing|deciding|shopping for|looking for)\b/gi,
  },
  success: {
    worked: /\b(worked!|works great|perfect|solved my problem|finally|success)\b/gi,
    achieved: /\b(achieved|accomplished|completed|finished|done)\b/gi,
  },
  learning: {
    understand: /\b(now I understand|makes sense|learned|taught me|showed me)\b/gi,
    howTo: /\b(how to|how do|can you|could you|tutorial|guide)\b/gi,
  }
};

const needsResults = {};
const needsExamples = {};

Object.keys(needsPatterns).forEach(category => {
  needsResults[category] = {};
  needsExamples[category] = {};
  
  Object.keys(needsPatterns[category]).forEach(pattern => {
    const matches = comments.filter(c => needsPatterns[category][pattern].test(c.comment_text));
    needsResults[category][pattern] = matches.length;
    
    // Get examples
    if (matches.length > 0) {
      needsExamples[category][pattern] = matches
        .slice(0, 3)
        .map(c => {
          const match = c.comment_text.match(needsPatterns[category][pattern]);
          if (match) {
            const start = Math.max(0, match.index - 20);
            const end = Math.min(c.comment_text.length, match.index + match[0].length + 50);
            return c.comment_text.substring(start, end).replace(/\n/g, ' ');
          }
          return '';
        })
        .filter(ex => ex);
    }
  });
});

console.log(`\n🎯 Goals & Intentions:`);
Object.entries(needsResults.goals).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

console.log(`\n✅ Success Indicators:`);
Object.entries(needsResults.success).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

// Pass 3: Pain Points & Barriers
console.log(`\n🚫 PASS 3: Pain Points & Barriers`);
console.log(`────────────────────────────────────────`);

const painPatterns = {
  frustration: {
    confused: /\b(confusing|confused|don't understand|lost|overwhelming)\b/gi,
    difficult: /\b(difficult|hard|complicated|complex|steep learning curve)\b/gi,
    doesntWork: /\b(doesn't work|won't work|not working|broken|failed)\b/gi,
  },
  constraints: {
    cost: /\b(expensive|cost|price|can't afford|budget|money)\b/gi,
    time: /\b(time consuming|takes too long|don't have time|hours|days)\b/gi,
    space: /\b(space|room|small|apartment|limited)\b/gi,
  },
  abandonment: {
    gaveUp: /\b(gave up|quit|stopped|abandoned|not for me)\b/gi,
    tooHard: /\b(too hard|too difficult|too advanced|too complicated)\b/gi,
  }
};

const painResults = {};
Object.keys(painPatterns).forEach(category => {
  painResults[category] = {};
  Object.keys(painPatterns[category]).forEach(pattern => {
    const matches = comments.filter(c => painPatterns[category][pattern].test(c.comment_text));
    painResults[category][pattern] = matches.length;
  });
});

console.log(`\n😤 Frustration Expressions:`);
Object.entries(painResults.frustration).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

console.log(`\n⛔ Resource Constraints:`);
Object.entries(painResults.constraints).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

// ============================================
// LAYER 2: PSYCHOLOGY (Why + How)
// ============================================

console.log(`\n═══════════════════════════════════════════`);
console.log(`LAYER 2: PSYCHOLOGY ANALYSIS`);
console.log(`═══════════════════════════════════════════\n`);

// Pass 5: Language & Identity Analysis
console.log(`🆔 PASS 5: Language & Identity Analysis`);
console.log(`────────────────────────────────────────`);

const identityPatterns = {
  selfIdentification: {
    beginner: /\b(as a beginner|I'm new|newbie here|just starting out)\b/gi,
    hobbyist: /\b(as a hobbyist|hobby user|weekend warrior|for fun)\b/gi,
    professional: /\b(as a professional|in my business|for my company|commercially)\b/gi,
    maker: /\b(as a maker|I make|I create|I build)\b/gi,
  },
  expertise: {
    technical: /\b(watts?|focal length|kerf|g-?code|lightburn|vectors?|raster)\b/gi,
    beginner: /\b(what is|how does|can someone explain|I don't know)\b/gi,
    confident: /\b(obviously|clearly|definitely|of course|everyone knows)\b/gi,
  },
  community: {
    belonging: /\b(we|us|our community|fellow makers?|you guys)\b/gi,
    teaching: /\b(I teach|I show|let me explain|here's how|pro tip)\b/gi,
  }
};

const identityResults = {};
Object.keys(identityPatterns).forEach(category => {
  identityResults[category] = {};
  Object.keys(identityPatterns[category]).forEach(pattern => {
    const matches = comments.filter(c => identityPatterns[category][pattern].test(c.comment_text));
    identityResults[category][pattern] = matches.length;
  });
});

console.log(`\n👤 Self-Identification:`);
Object.entries(identityResults.selfIdentification).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

console.log(`\n🎓 Expertise Indicators:`);
Object.entries(identityResults.expertise).forEach(([key, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${key}: ${count} (${percent}%)`);
});

// ============================================
// KEY INSIGHTS SUMMARY
// ============================================

console.log(`\n═══════════════════════════════════════════`);
console.log(`KEY INSIGHTS SUMMARY`);
console.log(`═══════════════════════════════════════════\n`);

// Calculate segment sizes based on patterns
const segments = {
  pragmaticProfessionals: comments.filter(c => 
    contextPatterns.lifeContext.business.test(c.comment_text) ||
    contextPatterns.experience.businessOwner.test(c.comment_text)
  ).length,
  
  aspiringCreators: comments.filter(c => 
    needsPatterns.goals.planning.test(c.comment_text) &&
    contextPatterns.experience.beginner.test(c.comment_text)
  ).length,
  
  technicalOptimizers: comments.filter(c => 
    identityPatterns.expertise.technical.test(c.comment_text) &&
    !contextPatterns.experience.beginner.test(c.comment_text)
  ).length,
  
  cautiousSkeptics: comments.filter(c => 
    c.comment_text.includes('lock') || 
    c.comment_text.includes('subscription') ||
    c.comment_text.includes('cloud') ||
    c.comment_text.includes('proprietary')
  ).length,
};

console.log(`📊 Estimated Segment Sizes:`);
Object.entries(segments).forEach(([segment, count]) => {
  const percent = ((count / comments.length) * 100).toFixed(1);
  console.log(`   ${segment}: ${count} comments (${percent}%)`);
});

// Top concerns
const concerns = {
  'Vendor lock-in': comments.filter(c => /\b(lock|locked|proprietary|subscription|cloud)\b/i.test(c.comment_text)).length,
  'Cost/Price': comments.filter(c => /\b(expensive|cost|price|afford|budget)\b/i.test(c.comment_text)).length,
  'Support quality': comments.filter(c => /\b(support|customer service|help|response)\b/i.test(c.comment_text)).length,
  'Learning curve': comments.filter(c => /\b(learning curve|difficult|complicated|confusing)\b/i.test(c.comment_text)).length,
  'Reliability': comments.filter(c => /\b(reliable|reliability|broken|failed|quality)\b/i.test(c.comment_text)).length,
};

console.log(`\n⚠️ Top Concerns:`);
Object.entries(concerns)
  .sort((a, b) => b[1] - a[1])
  .forEach(([concern, count]) => {
    const percent = ((count / comments.length) * 100).toFixed(1);
    console.log(`   ${concern}: ${count} mentions (${percent}%)`);
  });

// Save analysis results
const analysisResults = {
  totalComments: comments.length,
  contextResults,
  needsResults,
  painResults,
  identityResults,
  segments,
  concerns,
  timestamp: new Date().toISOString()
};

const resultsPath = path.join(process.cwd(), 'docs', 'customer-avatar-analysis-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(analysisResults, null, 2));

console.log(`\n✅ Analysis complete! Results saved to: ${resultsPath}`);
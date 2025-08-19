#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const comments = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));

console.log(`\n🔍 AVATAR CORE ANALYSIS - ACTUAL PATTERNS`);
console.log(`📊 Analyzing ${comments.length} comments for repeated patterns\n`);

// ============================================
// GOALS - What They Want to Achieve
// ============================================
console.log(`═══════════════════════════════════════════`);
console.log(`GOALS - What They Actually Want`);
console.log(`═══════════════════════════════════════════\n`);

const goalPatterns = {
  'Make purchase decision': /\b(which|what|best|recommend|should I (buy|get)|looking for|considering|deciding|comparing)\b/i,
  'Cut specific materials': /\b(cut|cutting) .{0,30}(wood|acrylic|metal|aluminum|plywood|leather|fabric)\b/i,
  'Engrave specific items': /\b(engrave|engraving) .{0,30}(metal|wood|leather|glass|tumbler|aluminum)\b/i,
  'Start a business': /\b(business|customer|client|selling|make money|side hustle|etsy)\b/i,
  'Learn how to use': /\b(how to|how do|tutorial|guide|step.by.step|learn|teach me)\b/i,
  'Fix/troubleshoot': /\b(not working|problem|issue|help|troubleshoot|fix|error)\b/i,
  'Upgrade equipment': /\b(upgrade|modify|improve|better|replacement)\b/i,
};

console.log(`📋 What They're Trying to Achieve:\n`);
Object.entries(goalPatterns).forEach(([goal, pattern]) => {
  const matches = comments.filter(c => pattern.test(c.comment_text));
  const percent = ((matches.length / comments.length) * 100).toFixed(1);
  console.log(`   ${goal}: ${matches.length} mentions (${percent}%)`);
  
  // Show example
  if (matches.length > 0) {
    const example = matches.find(m => m.comment_text.length < 200)?.comment_text || matches[0].comment_text;
    console.log(`      Example: "${example.substring(0, 150)}..."\n`);
  }
});

// ============================================
// PAINS - What's Holding Them Back
// ============================================
console.log(`\n═══════════════════════════════════════════`);
console.log(`PAINS - What's Actually Stopping Them`);
console.log(`═══════════════════════════════════════════\n`);

const painPatterns = {
  'Too expensive': /\b(expensive|cost|price|afford|budget|cheap|money)\b/i,
  'Confusing/complex': /\b(confusing|confused|complicated|complex|difficult|hard to|overwhelming)\b/i,
  'Poor support': /\b(support|customer service|help|response|contact)\b/i,
  'Software issues': /\b(software|lightburn|cloud|subscription|proprietary|lock)\b/i,
  'Space constraints': /\b(space|room|small|apartment|garage|shop)\b/i,
  'Ventilation concerns': /\b(ventilation|exhaust|fumes|smell|filter|window)\b/i,
  'Reliability worries': /\b(reliable|break|broken|quality|last|durable)\b/i,
  'Don\'t know what to buy': /\b(which one|what should|so many|options|choose|decision)\b/i,
};

console.log(`🚫 What's Blocking Them:\n`);
Object.entries(painPatterns).forEach(([pain, pattern]) => {
  const matches = comments.filter(c => pattern.test(c.comment_text));
  const percent = ((matches.length / comments.length) * 100).toFixed(1);
  console.log(`   ${pain}: ${matches.length} mentions (${percent}%)`);
  
  if (matches.length > 0) {
    const example = matches.find(m => m.comment_text.length < 200)?.comment_text || matches[0].comment_text;
    console.log(`      Example: "${example.substring(0, 150)}..."\n`);
  }
});

// ============================================
// LANGUAGE - How They Actually Talk
// ============================================
console.log(`\n═══════════════════════════════════════════`);
console.log(`LANGUAGE - How They Describe Things`);
console.log(`═══════════════════════════════════════════\n`);

// Common phrases they use
const commonPhrases = {};
comments.forEach(c => {
  const text = c.comment_text.toLowerCase();
  
  // Extract common question patterns
  const questions = text.match(/\b(what|which|how|can you|will it|does it|is it)\b[^.?!]{5,50}/g);
  if (questions) {
    questions.forEach(q => {
      const cleaned = q.trim().substring(0, 30);
      commonPhrases[cleaned] = (commonPhrases[cleaned] || 0) + 1;
    });
  }
});

console.log(`❓ Most Common Questions (actual words):\n`);
Object.entries(commonPhrases)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([phrase, count]) => {
    console.log(`   "${phrase}..." - ${count} times`);
  });

// ============================================
// SPECIFIC USE CASES
// ============================================
console.log(`\n═══════════════════════════════════════════`);
console.log(`SPECIFIC PROJECTS THEY MENTION`);
console.log(`═══════════════════════════════════════════\n`);

const projectMentions = {};
const projectPatterns = [
  /\b(name tag|nametag)s?\b/i,
  /\b(tumbler|cup|mug)s?\b/i,
  /\b(sign|signs)\b/i,
  /\btile[s]?\b/i,
  /\bcoaster[s]?\b/i,
  /\bjewelry\b/i,
  /\bornament[s]?\b/i,
  /\bwedding\b/i,
  /\bgift[s]?\b/i,
  /\betsy\b/i,
  /\bbusiness card[s]?\b/i,
  /\bsticker[s]?\b/i,
  /\bleather\b/i,
  /\bacrylic\b/i,
  /\bwood\b/i,
  /\bmetal\b/i,
];

projectPatterns.forEach(pattern => {
  const matches = comments.filter(c => pattern.test(c.comment_text));
  if (matches.length > 0) {
    const name = pattern.source.replace(/\\b|[^a-z ]/gi, '').trim();
    projectMentions[name] = matches.length;
  }
});

console.log(`🎯 Specific Things They Want to Make:\n`);
Object.entries(projectMentions)
  .sort((a, b) => b[1] - a[1])
  .forEach(([project, count]) => {
    const percent = ((count / comments.length) * 100).toFixed(2);
    console.log(`   ${project}: ${count} mentions (${percent}%)`);
  });

// ============================================
// EXPERTISE INDICATORS
// ============================================
console.log(`\n═══════════════════════════════════════════`);
console.log(`EXPERTISE LEVELS (from language)`);
console.log(`═══════════════════════════════════════════\n`);

const expertiseIndicators = {
  'Complete Beginner': /\b(new to this|first time|beginner|newbie|just starting|no experience|never done)\b/i,
  'Some Experience': /\b(I have a|I bought|I've been|my machine|my laser|my cnc)\b/i,
  'Technical Knowledge': /\b(watts|focal length|g-code|lightburn|vectors|kerf|dpi|frequency|power settings)\b/i,
  'Business Owner': /\b(my business|my customers|my shop|orders|clients|selling)\b/i,
};

console.log(`🎓 How They Self-Identify:\n`);
Object.entries(expertiseIndicators).forEach(([level, pattern]) => {
  const matches = comments.filter(c => pattern.test(c.comment_text));
  const percent = ((matches.length / comments.length) * 100).toFixed(1);
  console.log(`   ${level}: ${matches.length} (${percent}%)`);
});

// Save results
const results = {
  totalComments: comments.length,
  goals: Object.entries(goalPatterns).map(([goal, pattern]) => ({
    goal,
    count: comments.filter(c => pattern.test(c.comment_text)).length
  })),
  pains: Object.entries(painPatterns).map(([pain, pattern]) => ({
    pain,
    count: comments.filter(c => pattern.test(c.comment_text)).length
  })),
  projects: projectMentions,
  commonQuestions: Object.entries(commonPhrases)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([q, c]) => ({ question: q, count: c })),
  timestamp: new Date().toISOString()
};

fs.writeFileSync('docs/customer-avatar-core-patterns.json', JSON.stringify(results, null, 2));
console.log(`\n✅ Results saved to customer-avatar-core-patterns.json`);
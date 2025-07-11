export interface EducationalNiche {
  id: string;
  name: string;
  description: string;
  seedChannels: Array<{
    handle?: string;
    channelId?: string;
    name: string;
    tier: 'mega' | 'large' | 'medium'; // Subscriber tiers
  }>;
  searchTerms: string[];
  educationalSignals: string[];
  relatedNiches: string[];
}

export const EDUCATIONAL_NICHES: Record<string, EducationalNiche> = {
  diy: {
    id: 'diy',
    name: 'DIY & Making',
    description: 'Do-it-yourself projects, woodworking, crafting, and making',
    seedChannels: [
      { handle: 'ILikeToMakeStuff', name: 'I Like To Make Stuff', tier: 'large' },
      { handle: 'tested', name: 'Tested (Adam Savage)', tier: 'mega' },
      { handle: 'LauraKampf', name: 'Laura Kampf', tier: 'large' },
      { handle: 'SteveMould', name: 'Steve Mould', tier: 'large' },
      { handle: 'DIYPerks', name: 'DIY Perks', tier: 'large' },
      { handle: 'kingofrivers', name: 'King of Random', tier: 'mega' },
      { handle: 'NightHawkInLight', name: 'NightHawkInLight', tier: 'medium' }
    ],
    searchTerms: [
      'DIY tutorial', 'woodworking project', 'how to build', 'maker project',
      'workshop tutorial', 'handmade project', 'craft tutorial'
    ],
    educationalSignals: [
      'tutorial', 'how to build', 'step by step', 'workshop', 'project',
      'materials needed', 'tools required', 'beginner friendly'
    ],
    relatedNiches: ['woodworking', 'electronics', 'crafts']
  },

  cooking: {
    id: 'cooking',
    name: 'Cooking & Culinary',
    description: 'Cooking techniques, recipes, baking, and culinary education',
    seedChannels: [
      { handle: 'bingingwithbabish', name: 'Binging with Babish', tier: 'mega' },
      { handle: 'JoshuaWeissman', name: 'Joshua Weissman', tier: 'mega' },
      { handle: 'ProHomeCooks', name: 'Pro Home Cooks', tier: 'large' },
      { handle: 'AdamRagusea', name: 'Adam Ragusea', tier: 'large' },
      { handle: 'ChefJohnFoodWishes', name: 'Food Wishes', tier: 'mega' },
      { handle: 'EthanChlebowski', name: 'Ethan Chlebowski', tier: 'large' },
      { handle: 'BonAppetitMag', name: 'Bon Appétit', tier: 'mega' }
    ],
    searchTerms: [
      'cooking tutorial', 'recipe guide', 'how to cook', 'baking tutorial',
      'knife skills', 'cooking basics', 'culinary technique'
    ],
    educationalSignals: [
      'recipe', 'technique', 'how to cook', 'cooking basics', 'kitchen tips',
      'ingredients', 'step by step cooking', 'culinary skills'
    ],
    relatedNiches: ['nutrition', 'baking', 'restaurant']
  },

  fitness: {
    id: 'fitness',
    name: 'Fitness & Training',
    description: 'Workout routines, exercise form, fitness education',
    seedChannels: [
      { handle: 'JeffNippard', name: 'Jeff Nippard', tier: 'large' },
      { handle: 'AthleanX', name: 'Athlean-X', tier: 'mega' },
      { handle: 'ChloeTing', name: 'Chloe Ting', tier: 'mega' },
      { handle: 'FitnessBlender', name: 'Fitness Blender', tier: 'large' },
      { handle: 'OmarIsuf', name: 'Omar Isuf', tier: 'large' },
      { handle: 'Mindpumpshow', name: 'Mind Pump', tier: 'large' }
    ],
    searchTerms: [
      'workout tutorial', 'exercise form', 'fitness guide', 'how to exercise',
      'training program', 'muscle building', 'weight loss workout'
    ],
    educationalSignals: [
      'exercise', 'workout', 'form check', 'training', 'fitness tips',
      'muscle building', 'weight loss', 'beginner workout'
    ],
    relatedNiches: ['nutrition', 'health', 'bodybuilding']
  },

  health: {
    id: 'health',
    name: 'Health & Wellness',
    description: 'Health education, nutrition, medical information',
    seedChannels: [
      { handle: 'NutritionFactsOrg', name: 'NutritionFacts.org', tier: 'large' },
      { handle: 'ThomasDeLauer', name: 'Thomas DeLauer', tier: 'large' },
      { handle: 'drberg', name: 'Dr. Eric Berg', tier: 'mega' },
      { handle: 'medicalsecrets', name: 'Medical Secrets', tier: 'medium' },
      { handle: 'DrMike', name: 'Doctor Mike', tier: 'mega' }
    ],
    searchTerms: [
      'health education', 'nutrition guide', 'medical explanation', 'wellness tips',
      'healthy lifestyle', 'disease prevention', 'diet advice'
    ],
    educationalSignals: [
      'health tips', 'nutrition facts', 'medical advice', 'wellness',
      'healthy eating', 'disease prevention', 'scientific evidence'
    ],
    relatedNiches: ['fitness', 'nutrition', 'medical']
  },

  technology: {
    id: 'technology',
    name: 'Technology & Programming',
    description: 'Programming tutorials, tech reviews, computer science',
    seedChannels: [
      { handle: 'Fireship', name: 'Fireship', tier: 'large' },
      { handle: 'freecodecamp', name: 'freeCodeCamp', tier: 'mega' },
      { handle: 'ProgrammingwithMosh', name: 'Programming with Mosh', tier: 'large' },
      { handle: 'NetNinja', name: 'The Net Ninja', tier: 'large' },
      { handle: 'TechWithTim', name: 'Tech With Tim', tier: 'large' },
      { handle: 'CodeWithHarry', name: 'CodeWithHarry', tier: 'mega' }
    ],
    searchTerms: [
      'programming tutorial', 'coding guide', 'web development', 'how to code',
      'software engineering', 'tech tutorial', 'programming basics'
    ],
    educationalSignals: [
      'tutorial', 'how to code', 'programming', 'development', 'coding',
      'software', 'beginner guide', 'course', 'lesson'
    ],
    relatedNiches: ['webdev', 'ai', 'cybersecurity']
  },

  finance: {
    id: 'finance',
    name: 'Personal Finance',
    description: 'Financial education, investing, money management',
    seedChannels: [
      { handle: 'BenFelixPortfolio', name: 'Ben Felix', tier: 'large' },
      { handle: 'TheCompoundShow', name: 'The Compound', tier: 'large' },
      { handle: 'GrahamStephan', name: 'Graham Stephan', tier: 'mega' },
      { handle: 'AndreiJikh', name: 'Andrei Jikh', tier: 'large' },
      { handle: 'TwocentsPBS', name: 'Two Cents', tier: 'large' }
    ],
    searchTerms: [
      'personal finance', 'investing guide', 'money management', 'financial education',
      'how to invest', 'budgeting tips', 'retirement planning'
    ],
    educationalSignals: [
      'investing', 'finance', 'money tips', 'budgeting', 'financial planning',
      'stock market', 'retirement', 'passive income'
    ],
    relatedNiches: ['investing', 'economics', 'business']
  },

  photography: {
    id: 'photography',
    name: 'Photography & Videography',
    description: 'Photography techniques, camera tutorials, video production',
    seedChannels: [
      { handle: 'PeterMcKinnon', name: 'Peter McKinnon', tier: 'mega' },
      { handle: 'MattKloskowski', name: 'Matt Kloskowski', tier: 'large' },
      { handle: 'seantucker', name: 'Sean Tucker', tier: 'large' },
      { handle: 'TedForbes', name: 'Ted Forbes (The Art of Photography)', tier: 'large' },
      { handle: 'PiXimperfect', name: 'PiXimperfect', tier: 'large' }
    ],
    searchTerms: [
      'photography tutorial', 'camera settings', 'photo editing', 'composition guide',
      'lighting tutorial', 'photoshop tutorial', 'portrait photography'
    ],
    educationalSignals: [
      'photography', 'camera', 'editing', 'tutorial', 'technique',
      'composition', 'lighting', 'beginner photography'
    ],
    relatedNiches: ['videography', 'design', 'art']
  },

  language: {
    id: 'language',
    name: 'Language Learning',
    description: 'Language tutorials, pronunciation, grammar lessons',
    seedChannels: [
      { handle: 'SpanishPod101', name: 'SpanishPod101', tier: 'large' },
      { handle: 'FrenchPod101', name: 'FrenchPod101', tier: 'large' },
      { handle: 'JapanesePod101', name: 'JapanesePod101', tier: 'large' },
      { handle: 'EnglishClass101', name: 'EnglishClass101', tier: 'large' },
      { handle: 'SpanishwithPaul', name: 'Spanish with Paul', tier: 'medium' }
    ],
    searchTerms: [
      'language learning', 'how to speak', 'grammar lesson', 'pronunciation guide',
      'language tutorial', 'learn language', 'language basics'
    ],
    educationalSignals: [
      'learn', 'language', 'pronunciation', 'grammar', 'vocabulary',
      'lesson', 'tutorial', 'beginner', 'fluent'
    ],
    relatedNiches: ['education', 'culture', 'travel']
  },

  gardening: {
    id: 'gardening',
    name: 'Gardening & Homesteading',
    description: 'Gardening techniques, plant care, homesteading',
    seedChannels: [
      { handle: 'epicgardening', name: 'Epic Gardening', tier: 'large' },
      { handle: 'GrowVeg', name: 'GrowVeg', tier: 'medium' },
      { handle: 'migardener', name: 'MIgardener', tier: 'large' },
      { handle: 'TheRustedGarden', name: 'The Rusted Garden', tier: 'medium' },
      { handle: 'RootsandRefuge', name: 'Roots and Refuge Farm', tier: 'large' }
    ],
    searchTerms: [
      'gardening tutorial', 'how to grow', 'plant care', 'vegetable garden',
      'garden tips', 'homesteading', 'organic gardening'
    ],
    educationalSignals: [
      'gardening', 'growing', 'plants', 'garden', 'growing tips',
      'plant care', 'harvest', 'organic', 'homestead'
    ],
    relatedNiches: ['farming', 'sustainability', 'cooking']
  },

  music: {
    id: 'music',
    name: 'Music Education',
    description: 'Music theory, instrument tutorials, singing lessons',
    seedChannels: [
      { handle: 'MusicTheoryGuy', name: 'Music Theory Guy', tier: 'large' },
      { handle: 'JustinGuitar', name: 'JustinGuitar', tier: 'mega' },
      { handle: 'PianoVideoLessons', name: 'Piano Video Lessons', tier: 'large' },
      { handle: 'VoiceLessonsToTheWorld', name: 'Voice Lessons To The World', tier: 'large' },
      { handle: 'MarcusVeltri', name: 'Marcus Veltri', tier: 'medium' }
    ],
    searchTerms: [
      'music tutorial', 'how to play', 'music theory', 'guitar lesson',
      'piano tutorial', 'singing lesson', 'music education'
    ],
    educationalSignals: [
      'music', 'lesson', 'tutorial', 'how to play', 'music theory',
      'practice', 'technique', 'beginner', 'advanced'
    ],
    relatedNiches: ['audio', 'performance', 'art']
  }
};

export function getNicheSeeds(nicheId: string): EducationalNiche | null {
  return EDUCATIONAL_NICHES[nicheId] || null;
}

export function getAllNiches(): EducationalNiche[] {
  return Object.values(EDUCATIONAL_NICHES);
}

export function getNichesByCategory(category: string): EducationalNiche[] {
  return Object.values(EDUCATIONAL_NICHES).filter(niche => 
    niche.relatedNiches.includes(category) || niche.id === category
  );
}

export function getEducationalSignals(): string[] {
  const allSignals = new Set<string>();
  
  Object.values(EDUCATIONAL_NICHES).forEach(niche => {
    niche.educationalSignals.forEach(signal => allSignals.add(signal));
  });
  
  return Array.from(allSignals);
}

export function detectNicheFromChannel(channelTitle: string, description: string, recentVideoTitles: string[]): string[] {
  const content = `${channelTitle} ${description} ${recentVideoTitles.join(' ')}`.toLowerCase();
  const matches: string[] = [];
  
  Object.values(EDUCATIONAL_NICHES).forEach(niche => {
    let score = 0;
    
    // Check educational signals
    niche.educationalSignals.forEach(signal => {
      if (content.includes(signal.toLowerCase())) {
        score += 1;
      }
    });
    
    // Check search terms
    niche.searchTerms.forEach(term => {
      if (content.includes(term.toLowerCase())) {
        score += 2; // Search terms are more specific
      }
    });
    
    // If score is high enough, consider it a match
    if (score >= 3) {
      matches.push(niche.id);
    }
  });
  
  return matches;
}
/**
 * Discovery Query Generator
 * Generates diverse, high-yield search queries for YouTube channel discovery
 */

interface QueryTemplate {
  template: string;
  category: 'educational' | 'tutorial' | 'course' | 'trending' | 'cross_topic' | 'niche';
  weight: number; // Probability weight for selection
}

interface TopicExpansion {
  core: string;
  related: string[];
  adjacent: string[];
  trending: string[];
}

export class DiscoveryQueryGenerator {
  private queryTemplates: QueryTemplate[] = [
    // Educational content (high channel diversity)
    { template: '{topic} full course 2025', category: 'course', weight: 3 },
    { template: '{topic} tutorial playlist', category: 'tutorial', weight: 3 },
    { template: '{topic} for beginners complete guide', category: 'educational', weight: 3 },
    { template: 'learn {topic} from scratch', category: 'educational', weight: 2 },
    { template: '{topic} masterclass free', category: 'course', weight: 2 },
    { template: '{topic} bootcamp series', category: 'course', weight: 2 },
    { template: '{topic} crash course', category: 'course', weight: 2 },
    
    // Tutorial variations (finds active educators)
    { template: '{topic} tutorial 2025', category: 'tutorial', weight: 2 },
    { template: 'how to {topic} step by step', category: 'tutorial', weight: 2 },
    { template: '{topic} explained simply', category: 'educational', weight: 2 },
    { template: '{topic} walkthrough guide', category: 'tutorial', weight: 1 },
    { template: '{topic} hands on tutorial', category: 'tutorial', weight: 1 },
    
    // Workshop/seminar content (professional channels)
    { template: '{topic} workshop recording', category: 'educational', weight: 2 },
    { template: '{topic} webinar 2025', category: 'educational', weight: 1 },
    { template: '{topic} conference talk', category: 'educational', weight: 1 },
    { template: '{topic} summit presentation', category: 'educational', weight: 1 },
    
    // Compilation/multi-creator content (surfaces many channels)
    { template: 'best {topic} youtube channels 2025', category: 'niche', weight: 3 },
    { template: '{topic} expert interviews', category: 'niche', weight: 2 },
    { template: '{topic} podcast episodes', category: 'niche', weight: 2 },
    { template: '{topic} panel discussion', category: 'niche', weight: 1 },
    
    // Cross-topic discovery
    { template: '{topic1} for {topic2}', category: 'cross_topic', weight: 2 },
    { template: '{topic1} and {topic2} tutorial', category: 'cross_topic', weight: 2 },
    { template: '{topic1} vs {topic2} explained', category: 'cross_topic', weight: 1 },
    
    // Trending/current content
    { template: '{topic} 2025 latest', category: 'trending', weight: 2 },
    { template: 'new {topic} techniques 2025', category: 'trending', weight: 1 },
    { template: '{topic} trends 2025', category: 'trending', weight: 1 },
    { template: '{topic} updates 2025', category: 'trending', weight: 1 },
    
    // Specific skill queries
    { template: '{topic} certification prep', category: 'course', weight: 2 },
    { template: '{topic} exam preparation', category: 'course', weight: 1 },
    { template: '{topic} practice exercises', category: 'tutorial', weight: 1 },
    { template: '{topic} real world projects', category: 'tutorial', weight: 2 },
    { template: '{topic} case studies', category: 'educational', weight: 1 },
    
    // Business/professional angle
    { template: '{topic} for business', category: 'niche', weight: 2 },
    { template: '{topic} for entrepreneurs', category: 'niche', weight: 2 },
    { template: '{topic} freelancing guide', category: 'niche', weight: 1 },
    { template: '{topic} career advice', category: 'niche', weight: 1 }
  ];

  private topicCategories = {
    'Business & Entrepreneurship': {
      core: ['startup', 'business strategy', 'marketing', 'sales', 'leadership', 'entrepreneurship'],
      subcategories: ['digital marketing', 'content marketing', 'social media marketing', 'email marketing', 
                     'business development', 'venture capital', 'bootstrapping', 'saas business']
    },
    'Technology & Programming': {
      core: ['web development', 'python programming', 'javascript', 'machine learning', 'data science', 'cloud computing'],
      subcategories: ['react tutorial', 'nodejs', 'aws', 'docker', 'kubernetes', 'tensorflow', 'pytorch', 
                     'full stack development', 'mobile development', 'devops']
    },
    'Creative Skills': {
      core: ['video editing', 'graphic design', 'photography', 'content creation', 'animation', 'music production'],
      subcategories: ['adobe premiere', 'final cut pro', 'photoshop', 'illustrator', 'blender 3d', 
                     'davinci resolve', 'canva design', 'figma tutorial']
    },
    'Finance & Investing': {
      core: ['personal finance', 'investing', 'stock market', 'cryptocurrency', 'real estate', 'budgeting'],
      subcategories: ['day trading', 'value investing', 'crypto trading', 'forex', 'retirement planning', 
                     'passive income', 'financial independence', 'tax strategies']
    },
    'Health & Wellness': {
      core: ['fitness', 'nutrition', 'mental health', 'yoga', 'meditation', 'weight loss'],
      subcategories: ['home workout', 'strength training', 'meal prep', 'mindfulness', 'stress management', 
                     'sleep optimization', 'holistic health', 'biohacking']
    },
    'Professional Development': {
      core: ['career development', 'public speaking', 'productivity', 'time management', 'networking', 'interview skills'],
      subcategories: ['remote work', 'freelancing', 'personal branding', 'linkedin optimization', 
                     'resume writing', 'negotiation skills', 'project management', 'agile methodology']
    },
    'Academic & Learning': {
      core: ['study techniques', 'online learning', 'language learning', 'test preparation', 'research skills', 'writing skills'],
      subcategories: ['speed reading', 'note taking', 'memory techniques', 'academic writing', 
                     'exam strategies', 'dissertation writing', 'critical thinking', 'problem solving']
    },
    'Lifestyle & Hobbies': {
      core: ['cooking', 'travel', 'diy projects', 'gardening', 'gaming', 'crafts'],
      subcategories: ['home improvement', 'minimalism', 'sustainability', 'urban gardening', 
                     'meal planning', 'budget travel', 'van life', 'tiny house']
    }
  };

  /**
   * Generate a batch of diverse queries for discovery
   */
  async generateQueries(count: number = 100, options?: {
    focusCategories?: string[];
    includeCurrentTopics?: boolean;
    seedTopics?: string[];
  }): Promise<Array<{ query: string; category: string; queryType: string }>> {
    const queries: Array<{ query: string; category: string; queryType: string }> = [];
    const usedQueries = new Set<string>();

    // Get topics to use
    const topics = this.selectTopics(options?.seedTopics);
    
    // Generate queries with weighted template selection
    while (queries.length < count) {
      const topic = this.selectRandomTopic(topics);
      const template = this.selectWeightedTemplate();
      
      let query: string;
      if (template.category === 'cross_topic') {
        // Handle cross-topic queries
        const topic2 = this.selectRandomTopic(topics, topic);
        query = template.template
          .replace('{topic1}', topic)
          .replace('{topic2}', topic2);
      } else {
        query = template.template.replace('{topic}', topic);
      }
      
      // Avoid duplicates
      if (!usedQueries.has(query)) {
        usedQueries.add(query);
        queries.push({
          query,
          category: this.getTopicCategory(topic),
          queryType: template.category
        });
      }
    }

    return queries;
  }

  /**
   * Generate queries specifically for underrepresented topics
   */
  async generateGapFillingQueries(
    currentTopicDistribution: Map<string, number>,
    targetCount: number = 40
  ): Promise<Array<{ query: string; category: string; queryType: string }>> {
    // Identify underrepresented topics
    const underrepresented = this.identifyUnderrepresentedTopics(currentTopicDistribution);
    
    return this.generateQueries(targetCount, {
      seedTopics: underrepresented,
      focusCategories: ['educational', 'course', 'tutorial']
    });
  }

  /**
   * Generate trending topic queries
   */
  async generateTrendingQueries(count: number = 20): Promise<Array<{ query: string; category: string; queryType: string }>> {
    const trendingTopics = [
      'chatgpt tutorial', 'ai tools', 'prompt engineering', 'midjourney', 'stable diffusion',
      'no code development', 'bubble.io', 'automation', 'zapier', 'notion setup',
      'tiktok marketing', 'youtube shorts', 'threads app', 'ai content creation',
      'web3 development', 'blockchain programming', 'nft creation', 'defi tutorial'
    ];

    return this.generateQueries(count, {
      seedTopics: trendingTopics,
      focusCategories: ['trending']
    });
  }

  /**
   * Generate cross-topic queries for finding hybrid channels
   */
  async generateCrossTopicQueries(count: number = 30): Promise<Array<{ query: string; category: string; queryType: string }>> {
    const crossTopicPairs = [
      ['python', 'finance'], ['javascript', 'game development'], ['marketing', 'psychology'],
      ['data science', 'business'], ['design', 'freelancing'], ['productivity', 'programming'],
      ['ai', 'creative writing'], ['blockchain', 'finance'], ['video editing', 'youtube'],
      ['photography', 'business'], ['fitness', 'nutrition'], ['meditation', 'productivity']
    ];

    const queries: Array<{ query: string; category: string; queryType: string }> = [];
    const crossTopicTemplates = this.queryTemplates.filter(t => t.category === 'cross_topic');

    for (let i = 0; i < count; i++) {
      const [topic1, topic2] = crossTopicPairs[i % crossTopicPairs.length];
      const template = crossTopicTemplates[i % crossTopicTemplates.length];
      
      const query = template.template
        .replace('{topic1}', topic1)
        .replace('{topic2}', topic2);
        
      queries.push({
        query,
        category: 'cross_topic',
        queryType: template.category
      });
    }

    return queries;
  }

  private selectTopics(seedTopics?: string[]): string[] {
    if (seedTopics && seedTopics.length > 0) {
      return seedTopics;
    }

    // Flatten all topics from categories
    const allTopics: string[] = [];
    for (const category of Object.values(this.topicCategories)) {
      allTopics.push(...category.core);
      allTopics.push(...category.subcategories);
    }
    return allTopics;
  }

  private selectRandomTopic(topics: string[], exclude?: string): string {
    const available = exclude ? topics.filter(t => t !== exclude) : topics;
    return available[Math.floor(Math.random() * available.length)];
  }

  private selectWeightedTemplate(): QueryTemplate {
    const totalWeight = this.queryTemplates.reduce((sum, t) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const template of this.queryTemplates) {
      random -= template.weight;
      if (random <= 0) {
        return template;
      }
    }
    
    return this.queryTemplates[0]; // Fallback
  }

  private getTopicCategory(topic: string): string {
    for (const [category, data] of Object.entries(this.topicCategories)) {
      if (data.core.includes(topic) || data.subcategories.includes(topic)) {
        return category;
      }
    }
    return 'General';
  }

  private identifyUnderrepresentedTopics(distribution: Map<string, number>): string[] {
    const allTopics = this.selectTopics();
    const underrepresented: string[] = [];
    
    // Find topics with low or no representation
    for (const topic of allTopics) {
      const count = distribution.get(topic) || 0;
      if (count < 100) { // Threshold for underrepresented
        underrepresented.push(topic);
      }
    }
    
    // Sort by least represented first
    underrepresented.sort((a, b) => {
      const countA = distribution.get(a) || 0;
      const countB = distribution.get(b) || 0;
      return countA - countB;
    });
    
    return underrepresented.slice(0, 50); // Top 50 underrepresented
  }
}

// Export singleton instance
export const queryGenerator = new DiscoveryQueryGenerator();
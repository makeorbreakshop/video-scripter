import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

async function createProperHierarchy() {
  // Load the original BERTopic mapping
  const topicData = JSON.parse(
    await fs.readFile('./data/bertopic/better_topic_names_v2.json', 'utf-8')
  );
  
  // Define the proper hierarchy structure
  // This maps domains to their niches, and defines which clusters belong to each niche
  const hierarchyStructure = {
    'DIY & Crafts': {
      'Woodworking': {
        keywords: ['woodwork', 'wood', 'furniture', 'cabinet', 'joinery', 'lumber', 'epoxy table', 'epoxy river'],
        clusters: []
      },
      'Metalworking': {
        keywords: ['metal', 'weld', 'forge', 'blade', 'knife', 'steel'],
        clusters: []
      },
      'Digital Fabrication': {
        keywords: ['laser', 'cnc', '3d print', 'digital fabrication'],
        clusters: []
      },
      'Sewing & Textiles': {
        keywords: ['sew', 'fabric', 'textile', 'fashion diy', 'clothing'],
        clusters: []
      },
      'Home DIY': {
        keywords: ['home diy', 'home project', 'repair', 'renovation diy'],
        clusters: []
      },
      'Workshop': {
        keywords: ['workshop', 'tool', 'jig', 'shop'],
        clusters: []
      },
      'Crafts': {
        keywords: ['craft', 'resin art', 'artisan', 'handmade'],
        clusters: []
      }
    },
    'Technology': {
      'Programming': {
        keywords: ['programming', 'coding', 'development', 'javascript', 'python', 'web dev', 'full-stack'],
        clusters: []
      },
      'AI & Innovation': {
        keywords: ['ai', 'artificial intelligence', 'innovation', 'future tech'],
        clusters: []
      },
      'Photography & Video': {
        keywords: ['camera', 'photography', 'photo', 'drone', 'action camera'],
        clusters: []
      },
      'Audio Technology': {
        keywords: ['audio equipment', 'audio gear', 'music production tech'],
        clusters: []
      },
      'Gaming Tech': {
        keywords: ['gaming hardware', 'pc build', 'gaming pc', 'streaming tech'],
        clusters: []
      },
      '3D Printing': {
        keywords: ['3d print', '3d printer', 'additive'],
        clusters: []
      },
      'Electronics': {
        keywords: ['electronic', 'arduino', 'circuit', 'solder', 'robotics'],
        clusters: []
      },
      'Electric Vehicles': {
        keywords: ['tesla', 'electric vehicle', 'ev', 'electric car'],
        clusters: []
      },
      'Mobile & Computing': {
        keywords: ['apple', 'ios', 'android', 'mobile', 'computer'],
        clusters: []
      },
      'Tech Industry': {
        keywords: ['tech news', 'tech industry', 'tech review', 'product review'],
        clusters: []
      }
    },
    'Business': {
      'Entrepreneurship': {
        keywords: ['entrepreneur', 'startup', 'business scaling', 'business growth'],
        clusters: []
      },
      'Digital Marketing': {
        keywords: ['marketing', 'social media', 'content creation', 'youtube growth', 'instagram'],
        clusters: []
      },
      'E-commerce': {
        keywords: ['ecommerce', 'e-commerce', 'amazon', 'online business', 'dropship'],
        clusters: []
      },
      'Finance & Trading': {
        keywords: ['trading', 'stock', 'invest', 'crypto', 'forex'],
        clusters: []
      },
      'Business Strategy': {
        keywords: ['business strategy', 'management', 'business model'],
        clusters: []
      },
      'Creative Business': {
        keywords: ['photography business', 'creative business', 'freelance'],
        clusters: []
      }
    },
    'Music': {
      'Music Production': {
        keywords: ['music production', 'audio engineer', 'recording', 'mixing', 'studio'],
        clusters: []
      },
      'Instruments': {
        keywords: ['guitar', 'piano', 'drum', 'instrument', 'music lesson'],
        clusters: []
      },
      'Music Gear': {
        keywords: ['music gear', 'music equipment', 'pro audio', 'gear review'],
        clusters: []
      },
      'Performance': {
        keywords: ['music performance', 'cover', 'live music', 'concert'],
        clusters: []
      },
      'Music Business': {
        keywords: ['music business', 'music industry', 'music marketing'],
        clusters: []
      },
      'Music Theory': {
        keywords: ['music theory', 'composition', 'music education'],
        clusters: []
      },
      'Electronic Music': {
        keywords: ['electronic music', 'edm', 'dj', 'beat'],
        clusters: []
      }
    },
    'Education': {
      'Academic Subjects': {
        keywords: ['math', 'science', 'history', 'english', 'academic'],
        clusters: []
      },
      'Language Learning': {
        keywords: ['language', 'spanish', 'french', 'english learning', 'esl'],
        clusters: []
      },
      'Skills Training': {
        keywords: ['tutorial', 'how to', 'skill', 'training', 'course'],
        clusters: []
      },
      'Educational Content': {
        keywords: ['education', 'learning', 'teaching', 'classroom'],
        clusters: []
      },
      'Study Tips': {
        keywords: ['study', 'exam', 'test prep', 'student'],
        clusters: []
      }
    },
    'Gaming': {
      'Gameplay': {
        keywords: ['gameplay', 'lets play', 'gaming', 'walkthrough'],
        clusters: []
      },
      'Specific Games': {
        keywords: ['minecraft', 'fortnite', 'roblox', 'gta', 'call of duty'],
        clusters: []
      },
      'Esports': {
        keywords: ['esports', 'competitive', 'tournament', 'pro gaming'],
        clusters: []
      },
      'Gaming News': {
        keywords: ['gaming news', 'game review', 'gaming industry'],
        clusters: []
      },
      'Streaming': {
        keywords: ['stream', 'twitch', 'live gaming'],
        clusters: []
      }
    },
    'Lifestyle': {
      'Home & Organization': {
        keywords: ['home organization', 'cleaning', 'declutter', 'minimalist'],
        clusters: []
      },
      'Alternative Living': {
        keywords: ['tiny house', 'van life', 'rv', 'alternative living', 'mobile home'],
        clusters: []
      },
      'Fashion & Beauty': {
        keywords: ['fashion', 'beauty', 'makeup', 'style', 'outfit'],
        clusters: []
      },
      'Wellness': {
        keywords: ['wellness', 'mindfulness', 'self care', 'lifestyle'],
        clusters: []
      },
      'Family Life': {
        keywords: ['family', 'parenting', 'mom', 'dad', 'kids'],
        clusters: []
      },
      'Daily Vlogs': {
        keywords: ['vlog', 'daily life', 'routine', 'day in life'],
        clusters: []
      }
    },
    'Travel': {
      'Adventure Travel': {
        keywords: ['adventure', 'explore', 'backpack', 'hiking', 'outdoor travel'],
        clusters: []
      },
      'Destination Guides': {
        keywords: ['travel guide', 'destination', 'travel tips', 'travel planning'],
        clusters: []
      },
      'Theme Parks': {
        keywords: ['disney', 'theme park', 'amusement park', 'universal'],
        clusters: []
      },
      'Cultural Travel': {
        keywords: ['culture', 'cultural experience', 'world travel', 'international'],
        clusters: []
      }
    },
    'Food & Cooking': {
      'Recipes': {
        keywords: ['recipe', 'cooking', 'baking', 'meal prep'],
        clusters: []
      },
      'Food Reviews': {
        keywords: ['restaurant', 'food review', 'food tour', 'eating'],
        clusters: []
      },
      'Healthy Eating': {
        keywords: ['healthy', 'nutrition', 'diet', 'vegan', 'keto'],
        clusters: []
      }
    },
    'Health & Fitness': {
      'Workouts': {
        keywords: ['workout', 'exercise', 'fitness', 'gym', 'training'],
        clusters: []
      },
      'Running': {
        keywords: ['running', 'marathon', 'jogging', 'cardio'],
        clusters: []
      },
      'Nutrition': {
        keywords: ['nutrition', 'health', 'supplement', 'diet'],
        clusters: []
      }
    }
    // Continue for other domains...
  };
  
  // Assign clusters to niches based on keywords
  Object.entries(topicData.topics).forEach(([clusterId, info]) => {
    const domain = info.category;
    const microTopic = info.name.toLowerCase();
    const originalNiche = info.subcategory;
    
    let assigned = false;
    
    if (hierarchyStructure[domain]) {
      // Try to find the best niche match
      for (const [niche, nicheInfo] of Object.entries(hierarchyStructure[domain])) {
        // Check if any keywords match
        const matches = nicheInfo.keywords.some(keyword => 
          microTopic.includes(keyword) || originalNiche.toLowerCase().includes(keyword)
        );
        
        if (matches) {
          nicheInfo.clusters.push({
            id: parseInt(clusterId),
            name: info.name,
            originalNiche: originalNiche
          });
          assigned = true;
          break;
        }
      }
      
      // If not assigned, create a catch-all niche
      if (!assigned) {
        if (!hierarchyStructure[domain]['Other']) {
          hierarchyStructure[domain]['Other'] = {
            keywords: [],
            clusters: []
          };
        }
        hierarchyStructure[domain]['Other'].clusters.push({
          id: parseInt(clusterId),
          name: info.name,
          originalNiche: originalNiche
        });
      }
    }
  });
  
  // Create the new mapping structure
  const newMapping = {
    metadata: {
      version: "3.0",
      created: new Date().toISOString(),
      total_topics: 216,
      description: "Properly structured 3-level hierarchy for BERTopic clusters"
    },
    topics: {}
  };
  
  // Build the new topic mapping
  Object.entries(topicData.topics).forEach(([clusterId, info]) => {
    const domain = info.category;
    let assignedNiche = null;
    
    // Find which niche this cluster was assigned to
    if (hierarchyStructure[domain]) {
      for (const [niche, nicheInfo] of Object.entries(hierarchyStructure[domain])) {
        if (nicheInfo.clusters.some(c => c.id === parseInt(clusterId))) {
          assignedNiche = niche;
          break;
        }
      }
    }
    
    newMapping.topics[clusterId] = {
      name: info.name,  // This is the micro-topic
      category: domain,
      subcategory: assignedNiche || info.subcategory,  // Use new niche or fallback to original
      original_subcategory: info.subcategory  // Keep original for reference
    };
  });
  
  // Save the new mapping
  await fs.writeFile(
    './data/bertopic/better_topic_names_v3_proper_hierarchy.json',
    JSON.stringify(newMapping, null, 2)
  );
  
  // Create a summary report
  console.log('Hierarchy Restructuring Complete!');
  console.log('=================================\n');
  
  Object.entries(hierarchyStructure).forEach(([domain, niches]) => {
    const totalClusters = Object.values(niches).reduce((sum, n) => sum + n.clusters.length, 0);
    console.log(`${domain}: ${totalClusters} clusters across ${Object.keys(niches).length} niches`);
    
    Object.entries(niches).forEach(([niche, nicheInfo]) => {
      if (nicheInfo.clusters.length > 0) {
        console.log(`  ${niche}: ${nicheInfo.clusters.length} micro-topics`);
        // Show first 3 examples
        nicheInfo.clusters.slice(0, 3).forEach(cluster => {
          console.log(`    - Cluster ${cluster.id}: ${cluster.name}`);
        });
        if (nicheInfo.clusters.length > 3) {
          console.log(`    ... and ${nicheInfo.clusters.length - 3} more`);
        }
      }
    });
    console.log('');
  });
  
  console.log(`\nNew hierarchy saved to: ./data/bertopic/better_topic_names_v3_proper_hierarchy.json`);
}

createProperHierarchy().catch(console.error);
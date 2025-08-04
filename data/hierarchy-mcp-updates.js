// MCP Supabase Update Script
// Run each of these statements using the MCP Supabase execute_sql tool

const updates = [
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Woodworking Projects & Tool Reviews",
      [
        0
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Woodworking Projects & Tool Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Creative Woodworking Ideas",
      [
        15
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Creative Woodworking Ideas (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Furniture Making & Wood Design",
      [
        51
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Furniture Making & Wood Design (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Cabinet Making & Fine Woodworking",
      [
        64
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Cabinet Making & Fine Woodworking (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Epoxy River Tables & Furniture",
      [
        124
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Epoxy River Tables & Furniture (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Handmade Cutting Boards & Crafts",
      [
        153
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Handmade Cutting Boards & Crafts (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Precision Woodworking & Joinery",
      [
        173
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Precision Woodworking & Joinery (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Unique Furniture Designs & Builds",
      [
        178
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Unique Furniture Designs & Builds (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Woodworking",
      "Advanced Woodworking Techniques",
      [
        185
      ]
    ],
    "description": "DIY & Crafts > Woodworking > Advanced Woodworking Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Finance & Trading",
      "AI Business & Stock Trading",
      [
        1
      ]
    ],
    "description": "Business > Finance & Trading > AI Business & Stock Trading (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Home & Organization",
      "Home Cleaning & Organization Routines",
      [
        2
      ]
    ],
    "description": "Lifestyle > Home & Organization > Home Cleaning & Organization Routines (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Home & Organization",
      "Minimalist Lifestyle & Decluttering",
      [
        36
      ]
    ],
    "description": "Lifestyle > Home & Organization > Minimalist Lifestyle & Decluttering (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Home & Organization",
      "Extreme Decluttering & Minimalism",
      [
        117
      ]
    ],
    "description": "Lifestyle > Home & Organization > Extreme Decluttering & Minimalism (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Home & Organization",
      "Deep Cleaning & Organization Methods",
      [
        160
      ]
    ],
    "description": "Lifestyle > Home & Organization > Deep Cleaning & Organization Methods (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Health & Fitness",
      "Workouts",
      "Running & Fitness Training",
      [
        3
      ]
    ],
    "description": "Health & Fitness > Workouts > Running & Fitness Training (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Health & Fitness",
      "Workouts",
      "Fitness Challenges & Workouts",
      [
        82
      ]
    ],
    "description": "Health & Fitness > Workouts > Fitness Challenges & Workouts (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Alternative Living",
      "Tiny Living & Alternative Housing",
      [
        4
      ]
    ],
    "description": "Lifestyle > Alternative Living > Tiny Living & Alternative Housing (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Alternative Living",
      "Van Life & Nomadic Living",
      [
        125
      ]
    ],
    "description": "Lifestyle > Alternative Living > Van Life & Nomadic Living (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Alternative Living",
      "Mobile Home & Tiny House Tours",
      [
        198
      ]
    ],
    "description": "Lifestyle > Alternative Living > Mobile Home & Tiny House Tours (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electric Vehicles",
      "Tesla & Electric Vehicle Reviews",
      [
        5
      ]
    ],
    "description": "Technology > Electric Vehicles > Tesla & Electric Vehicle Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electric Vehicles",
      "Tech Product Unboxings",
      [
        33
      ]
    ],
    "description": "Technology > Electric Vehicles > Tech Product Unboxings (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Instruments",
      "Guitar Tutorials & Music Gear",
      [
        6
      ]
    ],
    "description": "Music > Instruments > Guitar Tutorials & Music Gear (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Instruments",
      "Music Theory & Instrument Lessons",
      [
        63
      ]
    ],
    "description": "Music > Instruments > Music Theory & Instrument Lessons (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Instruments",
      "Guitar Gear & Equipment Reviews",
      [
        85
      ]
    ],
    "description": "Music > Instruments > Guitar Gear & Equipment Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Instruments",
      "Musical Instrument Reviews",
      [
        91
      ]
    ],
    "description": "Music > Instruments > Musical Instrument Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Theme Parks",
      "Disney Parks & Travel Vlogs",
      [
        7
      ]
    ],
    "description": "Travel > Theme Parks > Disney Parks & Travel Vlogs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Other",
      "Live Streaming & 3D Content",
      [
        8
      ]
    ],
    "description": "Technology > Other > Live Streaming & 3D Content (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Other",
      "Technology Tutorials & How-To",
      [
        90
      ]
    ],
    "description": "Technology > Other > Technology Tutorials & How-To (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Digital Marketing",
      "Instagram Marketing & E-commerce",
      [
        9
      ]
    ],
    "description": "Business > Digital Marketing > Instagram Marketing & E-commerce (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Digital Marketing",
      "YouTube Channel Growth Strategies",
      [
        14
      ]
    ],
    "description": "Business > Digital Marketing > YouTube Channel Growth Strategies (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Digital Marketing",
      "Content Creation Tools & Tips",
      [
        34
      ]
    ],
    "description": "Business > Digital Marketing > Content Creation Tools & Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Digital Marketing",
      "Photography Business & Marketing",
      [
        201
      ]
    ],
    "description": "Business > Digital Marketing > Photography Business & Marketing (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Audio Technology",
      "Audio Equipment & Music Production",
      [
        10
      ]
    ],
    "description": "Technology > Audio Technology > Audio Equipment & Music Production (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Investing",
      "Stock Market & Real Estate Investing",
      [
        11
      ]
    ],
    "description": "Finance > Investing > Stock Market & Real Estate Investing (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Photography & Video",
      "Camera Gear & Photography Reviews",
      [
        12
      ]
    ],
    "description": "Technology > Photography & Video > Camera Gear & Photography Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Photography & Video",
      "Drone Flying & Aerial Photography",
      [
        41
      ]
    ],
    "description": "Technology > Photography & Video > Drone Flying & Aerial Photography (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Photography & Video",
      "Photography Accessories & Gear",
      [
        114
      ]
    ],
    "description": "Technology > Photography & Video > Photography Accessories & Gear (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Photography & Video",
      "Action Camera Reviews & Tests",
      [
        143
      ]
    ],
    "description": "Technology > Photography & Video > Action Camera Reviews & Tests (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Language Learning",
      "Spanish Language Learning",
      [
        13
      ]
    ],
    "description": "Education > Language Learning > Spanish Language Learning (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Language Learning",
      "Language Learning Tips & Resources",
      [
        172
      ]
    ],
    "description": "Education > Language Learning > Language Learning Tips & Resources (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Language Learning",
      "Polyglot Tips & Multiple Languages",
      [
        208
      ]
    ],
    "description": "Education > Language Learning > Polyglot Tips & Multiple Languages (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Entrepreneurship",
      "Business Scaling & Entrepreneurship",
      [
        16
      ]
    ],
    "description": "Business > Entrepreneurship > Business Scaling & Entrepreneurship (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Entrepreneurship",
      "Business Growth & Scaling Strategies",
      [
        168
      ]
    ],
    "description": "Business > Entrepreneurship > Business Growth & Scaling Strategies (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "AI & Innovation",
      "AI Tools & Technology News",
      [
        17
      ]
    ],
    "description": "Technology > AI & Innovation > AI Tools & Technology News (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "AI & Innovation",
      "Future Tech & Innovation Trends",
      [
        202
      ]
    ],
    "description": "Technology > AI & Innovation > Future Tech & Innovation Trends (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Live Stream Gaming & Tech",
      [
        18
      ]
    ],
    "description": "Gaming > Gameplay > Live Stream Gaming & Tech (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Minecraft Gameplay & Tutorials",
      [
        20
      ]
    ],
    "description": "Gaming > Gameplay > Minecraft Gameplay & Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Gaming News & Industry Updates",
      [
        93
      ]
    ],
    "description": "Gaming > Gameplay > Gaming News & Industry Updates (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Gaming Commentary & Let's Plays",
      [
        99
      ]
    ],
    "description": "Gaming > Gameplay > Gaming Commentary & Let's Plays (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Gaming Challenges & Competitions",
      [
        109
      ]
    ],
    "description": "Gaming > Gameplay > Gaming Challenges & Competitions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Esports & Competitive Gaming",
      [
        111
      ]
    ],
    "description": "Gaming > Gameplay > Esports & Competitive Gaming (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Fortnite Gameplay & Strategies",
      [
        135
      ]
    ],
    "description": "Gaming > Gameplay > Fortnite Gameplay & Strategies (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Gaming",
      "Gameplay",
      "Gaming Tutorials & Walkthroughs",
      [
        163
      ]
    ],
    "description": "Gaming > Gameplay > Gaming Tutorials & Walkthroughs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Food & Cooking",
      "Recipes",
      "Food & Cooking Tutorials",
      [
        19
      ]
    ],
    "description": "Food & Cooking > Recipes > Food & Cooking Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Food & Cooking",
      "Recipes",
      "Meal Prep & Healthy Eating",
      [
        23
      ]
    ],
    "description": "Food & Cooking > Recipes > Meal Prep & Healthy Eating (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Food & Cooking",
      "Recipes",
      "Nutrition & Healthy Recipes",
      [
        84
      ]
    ],
    "description": "Food & Cooking > Recipes > Nutrition & Healthy Recipes (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "Art History & Cultural Education",
      [
        21
      ]
    ],
    "description": "Education > Academic Subjects > Art History & Cultural Education (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "Study Tips & Academic Success",
      [
        30
      ]
    ],
    "description": "Education > Academic Subjects > Study Tips & Academic Success (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "Science Experiments & STEM Education",
      [
        40
      ]
    ],
    "description": "Education > Academic Subjects > Science Experiments & STEM Education (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "History Documentaries & Education",
      [
        46
      ]
    ],
    "description": "Education > Academic Subjects > History Documentaries & Education (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "Scientific Demonstrations & Education",
      [
        100
      ]
    ],
    "description": "Education > Academic Subjects > Scientific Demonstrations & Education (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Academic Subjects",
      "Chemistry & Science Experiments",
      [
        133
      ]
    ],
    "description": "Education > Academic Subjects > Chemistry & Science Experiments (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "3D Printing",
      "3D Printing Projects & Tutorials",
      [
        22
      ]
    ],
    "description": "Technology > 3D Printing > 3D Printing Projects & Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "3D Printing",
      "3D Printing Technology & Reviews",
      [
        97
      ]
    ],
    "description": "Technology > 3D Printing > 3D Printing Technology & Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "LEGO",
      "LEGO Building & Set Reviews",
      [
        24
      ]
    ],
    "description": "Hobbies > LEGO > LEGO Building & Set Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Photo Editing",
      "Photography Editing & Techniques",
      [
        25
      ]
    ],
    "description": "Arts & Media > Photo Editing > Photography Editing & Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Adventure Travel",
      "Adventure Travel & Exploration",
      [
        26
      ]
    ],
    "description": "Travel > Adventure Travel > Adventure Travel & Exploration (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Adventure Travel",
      "Travel Adventures & Culture",
      [
        49
      ]
    ],
    "description": "Travel > Adventure Travel > Travel Adventures & Culture (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Adventure Travel",
      "Adventure Planning & Travel Prep",
      [
        199
      ]
    ],
    "description": "Travel > Adventure Travel > Adventure Planning & Travel Prep (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Personal Development & Life Coaching",
      [
        27
      ]
    ],
    "description": "Lifestyle > Other > Personal Development & Life Coaching (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Christian Faith & Bible Study",
      [
        31
      ]
    ],
    "description": "Lifestyle > Other > Christian Faith & Bible Study (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Budget Living & Frugal Tips",
      [
        50
      ]
    ],
    "description": "Lifestyle > Other > Budget Living & Frugal Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Inspirational Content & Life Stories",
      [
        67
      ]
    ],
    "description": "Lifestyle > Other > Inspirational Content & Life Stories (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Micro Living & Tiny Apartments",
      [
        121
      ]
    ],
    "description": "Lifestyle > Other > Micro Living & Tiny Apartments (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Spiritual Growth & Faith Journey",
      [
        162
      ]
    ],
    "description": "Lifestyle > Other > Spiritual Growth & Faith Journey (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Alternative Housing & Off-Grid Living",
      [
        164
      ]
    ],
    "description": "Lifestyle > Other > Alternative Housing & Off-Grid Living (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Other",
      "Life Philosophy & Deep Thoughts",
      [
        195
      ]
    ],
    "description": "Lifestyle > Other > Life Philosophy & Deep Thoughts (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Gaming Tech",
      "Gaming Hardware & PC Building",
      [
        28
      ]
    ],
    "description": "Technology > Gaming Tech > Gaming Hardware & PC Building (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Production",
      "Professional Music Production",
      [
        29
      ]
    ],
    "description": "Music > Music Production > Professional Music Production (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Production",
      "Professional Audio Engineering",
      [
        79
      ]
    ],
    "description": "Music > Music Production > Professional Audio Engineering (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Production",
      "Electronic Music Production",
      [
        83
      ]
    ],
    "description": "Music > Music Production > Electronic Music Production (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Production",
      "Music Recording & Studio Setup",
      [
        89
      ]
    ],
    "description": "Music > Music Production > Music Recording & Studio Setup (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Motivational Speaking & Leadership",
      [
        32
      ]
    ],
    "description": "Business > Other > Motivational Speaking & Leadership (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Restaurant Business & Food Industry",
      [
        101
      ]
    ],
    "description": "Business > Other > Restaurant Business & Food Industry (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Real Estate Agent Training & Tips",
      [
        128
      ]
    ],
    "description": "Business > Other > Real Estate Agent Training & Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Public Speaking & Communication",
      [
        129
      ]
    ],
    "description": "Business > Other > Public Speaking & Communication (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Passive Income & Side Hustles",
      [
        145
      ]
    ],
    "description": "Business > Other > Passive Income & Side Hustles (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Other",
      "Content Strategy & Channel Growth",
      [
        212
      ]
    ],
    "description": "Business > Other > Content Strategy & Channel Growth (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Digital Fabrication",
      "Laser Cutting & CNC Projects",
      [
        35
      ]
    ],
    "description": "DIY & Crafts > Digital Fabrication > Laser Cutting & CNC Projects (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Destination Guides",
      "Travel Planning & Destination Guides",
      [
        37
      ]
    ],
    "description": "Travel > Destination Guides > Travel Planning & Destination Guides (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Destination Guides",
      "Travel Tips & Destination Reviews",
      [
        105
      ]
    ],
    "description": "Travel > Destination Guides > Travel Tips & Destination Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Educational Documentary Content",
      [
        38
      ]
    ],
    "description": "Education > Educational Content > Educational Documentary Content (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Educational Explainer Videos",
      [
        74
      ]
    ],
    "description": "Education > Educational Content > Educational Explainer Videos (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Medical Education & Health Facts",
      [
        147
      ]
    ],
    "description": "Education > Educational Content > Medical Education & Health Facts (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Coding Bootcamps & Tech Education",
      [
        171
      ]
    ],
    "description": "Education > Educational Content > Coding Bootcamps & Tech Education (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Effective Study Methods & Learning",
      [
        186
      ]
    ],
    "description": "Education > Educational Content > Effective Study Methods & Learning (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Cultural Education & World Awareness",
      [
        200
      ]
    ],
    "description": "Education > Educational Content > Cultural Education & World Awareness (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Art Education & Teaching Methods",
      [
        203
      ]
    ],
    "description": "Education > Educational Content > Art Education & Teaching Methods (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Scientific Art & STEAM Projects",
      [
        213
      ]
    ],
    "description": "Education > Educational Content > Scientific Art & STEAM Projects (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Educational Content",
      "Global Perspectives & World Views",
      [
        215
      ]
    ],
    "description": "Education > Educational Content > Global Perspectives & World Views (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Renovation",
      "Home Renovation & Improvement",
      [
        39
      ]
    ],
    "description": "Home & Garden > Renovation > Home Renovation & Improvement (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "E-commerce",
      "Online Business & Passive Income",
      [
        42
      ]
    ],
    "description": "Business > E-commerce > Online Business & Passive Income (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "E-commerce",
      "E-commerce & Amazon FBA",
      [
        68
      ]
    ],
    "description": "Business > E-commerce > E-commerce & Amazon FBA (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "E-commerce",
      "Amazon Business & E-commerce Tips",
      [
        158
      ]
    ],
    "description": "Business > E-commerce > Amazon Business & E-commerce Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "E-commerce",
      "E-commerce Strategies & Online Sales",
      [
        193
      ]
    ],
    "description": "Business > E-commerce > E-commerce Strategies & Online Sales (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Tech Industry",
      "Tech Industry News & Analysis",
      [
        43
      ]
    ],
    "description": "Technology > Tech Industry > Tech Industry News & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Tech Industry",
      "Tech News & Industry Updates",
      [
        122
      ]
    ],
    "description": "Technology > Tech Industry > Tech News & Industry Updates (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Family Life",
      "Family Vlogs & Parenting",
      [
        44
      ]
    ],
    "description": "Lifestyle > Family Life > Family Vlogs & Parenting (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Family Life",
      "Mom Life & Family Organization",
      [
        136
      ]
    ],
    "description": "Lifestyle > Family Life > Mom Life & Family Organization (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Camping",
      "Outdoor Adventure & Camping",
      [
        45
      ]
    ],
    "description": "Outdoors > Camping > Outdoor Adventure & Camping (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Other",
      "Historical Analysis & Storytelling",
      [
        47
      ]
    ],
    "description": "Education > Other > Historical Analysis & Storytelling (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "True Crime",
      "Mystery & True Crime Content",
      [
        48
      ]
    ],
    "description": "Entertainment > True Crime > Mystery & True Crime Content (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Organization",
      "Home Storage & Organization Solutions",
      [
        52
      ]
    ],
    "description": "Home & Garden > Organization > Home Storage & Organization Solutions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Creative Business",
      "Professional Photography Business",
      [
        53
      ]
    ],
    "description": "Business > Creative Business > Professional Photography Business (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Fashion & Beauty",
      "Daily Vlogs & Lifestyle Content",
      [
        54
      ]
    ],
    "description": "Lifestyle > Fashion & Beauty > Daily Vlogs & Lifestyle Content (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Fashion & Beauty",
      "Simple Living & Lifestyle Design",
      [
        126
      ]
    ],
    "description": "Lifestyle > Fashion & Beauty > Simple Living & Lifestyle Design (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Fashion & Beauty",
      "Lifestyle Transformation & Habits",
      [
        181
      ]
    ],
    "description": "Lifestyle > Fashion & Beauty > Lifestyle Transformation & Habits (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Fashion & Beauty",
      "Lifestyle Optimization & Efficiency",
      [
        205
      ]
    ],
    "description": "Lifestyle > Fashion & Beauty > Lifestyle Optimization & Efficiency (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Performance",
      "Music Performance & Covers",
      [
        55
      ]
    ],
    "description": "Music > Performance > Music Performance & Covers (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Performance",
      "Live Music & Concert Coverage",
      [
        211
      ]
    ],
    "description": "Music > Performance > Live Music & Concert Coverage (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Wellness",
      "Personal Growth & Mindfulness",
      [
        56
      ]
    ],
    "description": "Lifestyle > Wellness > Personal Growth & Mindfulness (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Metalworking",
      "Metalworking & Knife Making",
      [
        57
      ]
    ],
    "description": "DIY & Crafts > Metalworking > Metalworking & Knife Making (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Metalworking",
      "Professional Knife Making & Bladesmithing",
      [
        167
      ]
    ],
    "description": "DIY & Crafts > Metalworking > Professional Knife Making & Bladesmithing (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Metalworking",
      "Advanced Metalworking & Fabrication",
      [
        170
      ]
    ],
    "description": "DIY & Crafts > Metalworking > Advanced Metalworking & Fabrication (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Sports",
      "Extreme Sports",
      "Adventure Sports & Extreme Activities",
      [
        58
      ]
    ],
    "description": "Sports > Extreme Sports > Adventure Sports & Extreme Activities (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Programming",
      "Programming & Coding Tutorials",
      [
        59
      ]
    ],
    "description": "Technology > Programming > Programming & Coding Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Programming",
      "Python Programming & Data Science",
      [
        165
      ]
    ],
    "description": "Technology > Programming > Python Programming & Data Science (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Programming",
      "Web Development & JavaScript",
      [
        175
      ]
    ],
    "description": "Technology > Programming > Web Development & JavaScript (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Programming",
      "Full-Stack Development & Coding",
      [
        183
      ]
    ],
    "description": "Technology > Programming > Full-Stack Development & Coding (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Pop Culture",
      "Entertainment News & Pop Culture",
      [
        60
      ]
    ],
    "description": "Entertainment > Pop Culture > Entertainment News & Pop Culture (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Food & Cooking",
      "Food Reviews",
      "Restaurant Reviews & Food Tours",
      [
        61
      ]
    ],
    "description": "Food & Cooking > Food Reviews > Restaurant Reviews & Food Tours (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Lifestyle",
      "Daily Vlogs",
      "Morning Routines & Productivity",
      [
        62
      ]
    ],
    "description": "Lifestyle > Daily Vlogs > Morning Routines & Productivity (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "News & Politics",
      "Current Events",
      "World News & Current Events",
      [
        65
      ]
    ],
    "description": "News & Politics > Current Events > World News & Current Events (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Gear Reviews",
      "Camping Gear Reviews & Tips",
      [
        66
      ]
    ],
    "description": "Outdoors > Gear Reviews > Camping Gear Reviews & Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Painting",
      "Painting Techniques & Art Tutorials",
      [
        69
      ]
    ],
    "description": "Arts & Media > Painting > Painting Techniques & Art Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Home Repair",
      "Home Repairs & Maintenance",
      [
        70
      ]
    ],
    "description": "Home & Garden > Home Repair > Home Repairs & Maintenance (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Real Estate",
      "Real Estate Investment Strategies",
      [
        71
      ]
    ],
    "description": "Finance > Real Estate > Real Estate Investment Strategies (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Bathrooms",
      "Bathroom Renovations & Plumbing",
      [
        72
      ]
    ],
    "description": "Home & Garden > Bathrooms > Bathroom Renovations & Plumbing (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Other",
      "RV Life & Mobile Living",
      [
        73
      ]
    ],
    "description": "Travel > Other > RV Life & Mobile Living (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Star Wars",
      "Star Wars Fan Content & Reviews",
      [
        75
      ]
    ],
    "description": "Entertainment > Star Wars > Star Wars Fan Content & Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Survival",
      "Outdoor Survival & Bushcraft",
      [
        76
      ]
    ],
    "description": "Outdoors > Survival > Outdoor Survival & Bushcraft (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Gear",
      "Music Gear Reviews & Demos",
      [
        77
      ]
    ],
    "description": "Music > Music Gear > Music Gear Reviews & Demos (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Gear",
      "Professional Music Equipment",
      [
        94
      ]
    ],
    "description": "Music > Music Gear > Professional Music Equipment (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Kitchens",
      "Kitchen Design & Renovation",
      [
        78
      ]
    ],
    "description": "Home & Garden > Kitchens > Kitchen Design & Renovation (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Art Education",
      "Art Techniques & Creative Process",
      [
        80
      ]
    ],
    "description": "Arts & Media > Art Education > Art Techniques & Creative Process (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Small Spaces",
      "Small Space Design Solutions",
      [
        81
      ]
    ],
    "description": "Home & Garden > Small Spaces > Small Space Design Solutions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "News & Politics",
      "Political Analysis",
      "Political Commentary & Analysis",
      [
        86
      ]
    ],
    "description": "News & Politics > Political Analysis > Political Commentary & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Winter Activities",
      "Winter Camping & Cold Weather Gear",
      [
        87
      ]
    ],
    "description": "Outdoors > Winter Activities > Winter Camping & Cold Weather Gear (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Photography Projects",
      "Creative Photography Projects",
      [
        88
      ]
    ],
    "description": "Arts & Media > Photography Projects > Creative Photography Projects (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "News & Politics",
      "World News",
      "International News & Global Affairs",
      [
        92
      ]
    ],
    "description": "News & Politics > World News > International News & Global Affairs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Comedy",
      "Comedy Sketches & Entertainment",
      [
        95
      ]
    ],
    "description": "Entertainment > Comedy > Comedy Sketches & Entertainment (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "LEGO Technic",
      "LEGO Technic & Advanced Builds",
      [
        96
      ]
    ],
    "description": "Hobbies > LEGO Technic > LEGO Technic & Advanced Builds (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Sports",
      "Sports History",
      "Sports History & Analysis",
      [
        98
      ]
    ],
    "description": "Sports > Sports History > Sports History & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Trading",
      "Stock Trading Strategies & Tips",
      [
        102
      ]
    ],
    "description": "Finance > Trading > Stock Trading Strategies & Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Market Analysis",
      "Real Estate Market Analysis",
      [
        103
      ]
    ],
    "description": "Finance > Market Analysis > Real Estate Market Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Home DIY",
      "DIY Home Projects & Repairs",
      [
        104
      ]
    ],
    "description": "DIY & Crafts > Home DIY > DIY Home Projects & Repairs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Personal Finance",
      "Personal Finance & Money Management",
      [
        106
      ]
    ],
    "description": "Finance > Personal Finance > Personal Finance & Money Management (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Equipment",
      "Outdoor Gear & Equipment Reviews",
      [
        107
      ]
    ],
    "description": "Outdoors > Equipment > Outdoor Gear & Equipment Reviews (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "Card Games",
      "Trading Card Games & Collectibles",
      [
        108
      ]
    ],
    "description": "Hobbies > Card Games > Trading Card Games & Collectibles (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Drawing",
      "Drawing Tutorials & Techniques",
      [
        110
      ]
    ],
    "description": "Arts & Media > Drawing > Drawing Tutorials & Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electronics",
      "Robotics Projects & Engineering",
      [
        112
      ]
    ],
    "description": "Technology > Electronics > Robotics Projects & Engineering (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electronics",
      "Electronics Projects & Arduino",
      [
        132
      ]
    ],
    "description": "Technology > Electronics > Electronics Projects & Arduino (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electronics",
      "Electronics Assembly & Soldering",
      [
        155
      ]
    ],
    "description": "Technology > Electronics > Electronics Assembly & Soldering (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Electronics",
      "Advanced Electronics & Circuit Design",
      [
        159
      ]
    ],
    "description": "Technology > Electronics > Advanced Electronics & Circuit Design (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Automotive",
      "Car Repair",
      "Auto Repair & Car Maintenance",
      [
        113
      ]
    ],
    "description": "Automotive > Car Repair > Auto Repair & Car Maintenance (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Wall Repair",
      "Drywall & Ceiling Repairs",
      [
        115
      ]
    ],
    "description": "Home & Garden > Wall Repair > Drywall & Ceiling Repairs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Crafts",
      "Epoxy Resin Art & Tables",
      [
        116
      ]
    ],
    "description": "DIY & Crafts > Crafts > Epoxy Resin Art & Tables (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Crafts",
      "Artisan Crafts & Handmade Goods",
      [
        197
      ]
    ],
    "description": "DIY & Crafts > Crafts > Artisan Crafts & Handmade Goods (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Sewing & Textiles",
      "Sewing Projects & Fashion DIY",
      [
        118
      ]
    ],
    "description": "DIY & Crafts > Sewing & Textiles > Sewing Projects & Fashion DIY (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Star Wars Lore",
      "Star Wars Lore & Deep Dives",
      [
        119
      ]
    ],
    "description": "Entertainment > Star Wars Lore > Star Wars Lore & Deep Dives (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Education",
      "Skills Training",
      "Educational Series & Crash Courses",
      [
        120
      ]
    ],
    "description": "Education > Skills Training > Educational Series & Crash Courses (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Business",
      "Business Strategy",
      "Business Strategy & Management",
      [
        123
      ]
    ],
    "description": "Business > Business Strategy > Business Strategy & Management (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Housing Market",
      "Housing Market Trends & Analysis",
      [
        127
      ]
    ],
    "description": "Finance > Housing Market > Housing Market Trends & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Creator Content",
      "YouTube Milestones & Celebrations",
      [
        130
      ]
    ],
    "description": "Entertainment > Creator Content > YouTube Milestones & Celebrations (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Health & Wellness",
      "Eye Care",
      "Eye Health & Vision Care",
      [
        131
      ]
    ],
    "description": "Health & Wellness > Eye Care > Eye Health & Vision Care (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "Pokemon Cards",
      "Pokemon Card Collecting & Opening",
      [
        134
      ]
    ],
    "description": "Hobbies > Pokemon Cards > Pokemon Card Collecting & Opening (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Winter Sports",
      "Winter Outdoor Adventures",
      [
        137
      ]
    ],
    "description": "Outdoors > Winter Sports > Winter Outdoor Adventures (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Other",
      "RV Renovations & Upgrades",
      [
        138
      ]
    ],
    "description": "DIY & Crafts > Other > RV Renovations & Upgrades (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Other",
      "Tiny House Building & Design",
      [
        204
      ]
    ],
    "description": "DIY & Crafts > Other > Tiny House Building & Design (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Art History",
      "Art History & Technique Analysis",
      [
        139
      ]
    ],
    "description": "Arts & Media > Art History > Art History & Technique Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Painting Tutorials",
      "Step-by-Step Painting Tutorials",
      [
        140
      ]
    ],
    "description": "Arts & Media > Painting Tutorials > Step-by-Step Painting Tutorials (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "LEGO Collecting",
      "LEGO Star Wars Collections",
      [
        141
      ]
    ],
    "description": "Hobbies > LEGO Collecting > LEGO Star Wars Collections (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Sports",
      "Formula 1",
      "Formula 1 Racing & Analysis",
      [
        142
      ]
    ],
    "description": "Sports > Formula 1 > Formula 1 Racing & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Health & Fitness",
      "Other",
      "Bodybuilding & Muscle Growth",
      [
        144
      ]
    ],
    "description": "Health & Fitness > Other > Bodybuilding & Muscle Growth (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Sports",
      "Martial Arts",
      "Martial Arts Training & Techniques",
      [
        146
      ]
    ],
    "description": "Sports > Martial Arts > Martial Arts Training & Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Slow Motion",
      "Slow Motion Science & Experiments",
      [
        148
      ]
    ],
    "description": "Entertainment > Slow Motion > Slow Motion Science & Experiments (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Hobbies",
      "Cosplay",
      "Prop Making & 3D Printed Cosplay",
      [
        149
      ]
    ],
    "description": "Hobbies > Cosplay > Prop Making & 3D Printed Cosplay (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Sports",
      "College Football",
      "College Football Coverage & Analysis",
      [
        150
      ]
    ],
    "description": "Sports > College Football > College Football Coverage & Analysis (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Bathroom Design",
      "Bathroom Design & Renovation Ideas",
      [
        151
      ]
    ],
    "description": "Home & Garden > Bathroom Design > Bathroom Design & Renovation Ideas (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Other",
      "Music Reaction Videos & Commentary",
      [
        152
      ]
    ],
    "description": "Music > Other > Music Reaction Videos & Commentary (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Other",
      "Professional Audio Production Tips",
      [
        194
      ]
    ],
    "description": "Music > Other > Professional Audio Production Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Technology",
      "Mobile & Computing",
      "iOS Tips & Apple Ecosystem",
      [
        154
      ]
    ],
    "description": "Technology > Mobile & Computing > iOS Tips & Apple Ecosystem (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Kitchen Storage",
      "Kitchen Organization & Storage Hacks",
      [
        156
      ]
    ],
    "description": "Home & Garden > Kitchen Storage > Kitchen Organization & Storage Hacks (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Entertainment",
      "Live Interaction",
      "Live Q&A Sessions & Community",
      [
        157
      ]
    ],
    "description": "Entertainment > Live Interaction > Live Q&A Sessions & Community (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Videography",
      "Professional Videography & Filming",
      [
        161
      ]
    ],
    "description": "Arts & Media > Videography > Professional Videography & Filming (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Custom Storage",
      "Custom Storage Solutions & Built-ins",
      [
        166
      ]
    ],
    "description": "Home & Garden > Custom Storage > Custom Storage Solutions & Built-ins (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Digital Art",
      "Digital Art & Illustration Techniques",
      [
        169
      ]
    ],
    "description": "Arts & Media > Digital Art > Digital Art & Illustration Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Finance",
      "Wealth Building",
      "Investment Strategies & Wealth Building",
      [
        174
      ]
    ],
    "description": "Finance > Wealth Building > Investment Strategies & Wealth Building (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Workshop Organization & Tool Storage",
      [
        176
      ]
    ],
    "description": "DIY & Crafts > Workshop > Workshop Organization & Tool Storage (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Professional Tool Reviews & Comparisons",
      [
        179
      ]
    ],
    "description": "DIY & Crafts > Workshop > Professional Tool Reviews & Comparisons (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Specialty Tool Making & Jigs",
      [
        191
      ]
    ],
    "description": "DIY & Crafts > Workshop > Specialty Tool Making & Jigs (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Custom Jigs & Workshop Solutions",
      [
        196
      ]
    ],
    "description": "DIY & Crafts > Workshop > Custom Jigs & Workshop Solutions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Home Workshop Setup & Organization",
      [
        210
      ]
    ],
    "description": "DIY & Crafts > Workshop > Home Workshop Setup & Organization (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "DIY & Crafts",
      "Workshop",
      "Professional Workshop Equipment",
      [
        214
      ]
    ],
    "description": "DIY & Crafts > Workshop > Professional Workshop Equipment (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Documentary",
      "Documentary Filmmaking & Storytelling",
      [
        177
      ]
    ],
    "description": "Arts & Media > Documentary > Documentary Filmmaking & Storytelling (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Space Saving",
      "Space-Saving Furniture & Solutions",
      [
        180
      ]
    ],
    "description": "Home & Garden > Space Saving > Space-Saving Furniture & Solutions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Modular Storage",
      "Modular Storage Systems & Organization",
      [
        182
      ]
    ],
    "description": "Home & Garden > Modular Storage > Modular Storage Systems & Organization (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Business",
      "Professional Music Industry Insights",
      [
        184
      ]
    ],
    "description": "Music > Music Business > Professional Music Industry Insights (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Business",
      "Music Business & Industry Tips",
      [
        188
      ]
    ],
    "description": "Music > Music Business > Music Business & Industry Tips (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Mixed Media",
      "Mixed Media Art & Experimental Techniques",
      [
        187
      ]
    ],
    "description": "Arts & Media > Mixed Media > Mixed Media Art & Experimental Techniques (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Creative Storage",
      "Creative Storage & Organization Ideas",
      [
        189
      ]
    ],
    "description": "Home & Garden > Creative Storage > Creative Storage & Organization Ideas (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Arts & Media",
      "Traditional Art",
      "Traditional Art Techniques & Methods",
      [
        190
      ]
    ],
    "description": "Arts & Media > Traditional Art > Traditional Art Techniques & Methods (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Travel",
      "Cultural Travel",
      "Global Travel & Cultural Experiences",
      [
        192
      ]
    ],
    "description": "Travel > Cultural Travel > Global Travel & Cultural Experiences (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Home & Garden",
      "Custom Shelving",
      "Custom Shelving & Display Solutions",
      [
        206
      ]
    ],
    "description": "Home & Garden > Custom Shelving > Custom Shelving & Display Solutions (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Outdoors",
      "Extreme Camping",
      "Extreme Weather Camping & Gear",
      [
        207
      ]
    ],
    "description": "Outdoors > Extreme Camping > Extreme Weather Camping & Gear (1 clusters)"
  },
  {
    "sql": "UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])",
    "params": [
      "Music",
      "Music Theory",
      "Music Theory & Composition",
      [
        209
      ]
    ],
    "description": "Music > Music Theory > Music Theory & Composition (1 clusters)"
  }
];

// Execute each update
for (const update of updates) {
  console.log(`Executing: ${update.description}`);
  // Use mcp__supabase__execute_sql with update.sql and update.params
}

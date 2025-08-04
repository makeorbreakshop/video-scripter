-- Individual UPDATE statements for manual execution

-- Statement 1: DIY & Crafts > Woodworking > Woodworking Projects & Tool Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Woodworking Projects & Tool Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (0);

-- Statement 2: DIY & Crafts > Woodworking > Creative Woodworking Ideas (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Creative Woodworking Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (15);

-- Statement 3: DIY & Crafts > Woodworking > Furniture Making & Wood Design (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Furniture Making & Wood Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (51);

-- Statement 4: DIY & Crafts > Woodworking > Cabinet Making & Fine Woodworking (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Cabinet Making & Fine Woodworking',
  updated_at = NOW()
WHERE topic_cluster_id IN (64);

-- Statement 5: DIY & Crafts > Woodworking > Epoxy River Tables & Furniture (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Epoxy River Tables & Furniture',
  updated_at = NOW()
WHERE topic_cluster_id IN (124);

-- Statement 6: DIY & Crafts > Woodworking > Handmade Cutting Boards & Crafts (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Handmade Cutting Boards & Crafts',
  updated_at = NOW()
WHERE topic_cluster_id IN (153);

-- Statement 7: DIY & Crafts > Woodworking > Precision Woodworking & Joinery (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Precision Woodworking & Joinery',
  updated_at = NOW()
WHERE topic_cluster_id IN (173);

-- Statement 8: DIY & Crafts > Woodworking > Unique Furniture Designs & Builds (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Unique Furniture Designs & Builds',
  updated_at = NOW()
WHERE topic_cluster_id IN (178);

-- Statement 9: DIY & Crafts > Woodworking > Advanced Woodworking Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Advanced Woodworking Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (185);

-- Statement 10: Business > Finance & Trading > AI Business & Stock Trading (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Finance & Trading',
  topic_micro = 'AI Business & Stock Trading',
  updated_at = NOW()
WHERE topic_cluster_id IN (1);

-- Statement 11: Lifestyle > Home & Organization > Home Cleaning & Organization Routines (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Home Cleaning & Organization Routines',
  updated_at = NOW()
WHERE topic_cluster_id IN (2);

-- Statement 12: Lifestyle > Home & Organization > Minimalist Lifestyle & Decluttering (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Minimalist Lifestyle & Decluttering',
  updated_at = NOW()
WHERE topic_cluster_id IN (36);

-- Statement 13: Lifestyle > Home & Organization > Extreme Decluttering & Minimalism (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Extreme Decluttering & Minimalism',
  updated_at = NOW()
WHERE topic_cluster_id IN (117);

-- Statement 14: Lifestyle > Home & Organization > Deep Cleaning & Organization Methods (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Deep Cleaning & Organization Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (160);

-- Statement 15: Health & Fitness > Workouts > Running & Fitness Training (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Workouts',
  topic_micro = 'Running & Fitness Training',
  updated_at = NOW()
WHERE topic_cluster_id IN (3);

-- Statement 16: Health & Fitness > Workouts > Fitness Challenges & Workouts (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Workouts',
  topic_micro = 'Fitness Challenges & Workouts',
  updated_at = NOW()
WHERE topic_cluster_id IN (82);

-- Statement 17: Lifestyle > Alternative Living > Tiny Living & Alternative Housing (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Tiny Living & Alternative Housing',
  updated_at = NOW()
WHERE topic_cluster_id IN (4);

-- Statement 18: Lifestyle > Alternative Living > Van Life & Nomadic Living (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Van Life & Nomadic Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (125);

-- Statement 19: Lifestyle > Alternative Living > Mobile Home & Tiny House Tours (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Mobile Home & Tiny House Tours',
  updated_at = NOW()
WHERE topic_cluster_id IN (198);

-- Statement 20: Technology > Electric Vehicles > Tesla & Electric Vehicle Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electric Vehicles',
  topic_micro = 'Tesla & Electric Vehicle Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (5);

-- Statement 21: Technology > Electric Vehicles > Tech Product Unboxings (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electric Vehicles',
  topic_micro = 'Tech Product Unboxings',
  updated_at = NOW()
WHERE topic_cluster_id IN (33);

-- Statement 22: Music > Instruments > Guitar Tutorials & Music Gear (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Guitar Tutorials & Music Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (6);

-- Statement 23: Music > Instruments > Music Theory & Instrument Lessons (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Music Theory & Instrument Lessons',
  updated_at = NOW()
WHERE topic_cluster_id IN (63);

-- Statement 24: Music > Instruments > Guitar Gear & Equipment Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Guitar Gear & Equipment Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (85);

-- Statement 25: Music > Instruments > Musical Instrument Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Musical Instrument Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (91);

-- Statement 26: Travel > Theme Parks > Disney Parks & Travel Vlogs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Theme Parks',
  topic_micro = 'Disney Parks & Travel Vlogs',
  updated_at = NOW()
WHERE topic_cluster_id IN (7);

-- Statement 27: Technology > Other > Live Streaming & 3D Content (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Other',
  topic_micro = 'Live Streaming & 3D Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (8);

-- Statement 28: Technology > Other > Technology Tutorials & How-To (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Other',
  topic_micro = 'Technology Tutorials & How-To',
  updated_at = NOW()
WHERE topic_cluster_id IN (90);

-- Statement 29: Business > Digital Marketing > Instagram Marketing & E-commerce (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Instagram Marketing & E-commerce',
  updated_at = NOW()
WHERE topic_cluster_id IN (9);

-- Statement 30: Business > Digital Marketing > YouTube Channel Growth Strategies (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'YouTube Channel Growth Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (14);

-- Statement 31: Business > Digital Marketing > Content Creation Tools & Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Content Creation Tools & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (34);

-- Statement 32: Business > Digital Marketing > Photography Business & Marketing (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Photography Business & Marketing',
  updated_at = NOW()
WHERE topic_cluster_id IN (201);

-- Statement 33: Technology > Audio Technology > Audio Equipment & Music Production (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Audio Technology',
  topic_micro = 'Audio Equipment & Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (10);

-- Statement 34: Finance > Investing > Stock Market & Real Estate Investing (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Investing',
  topic_micro = 'Stock Market & Real Estate Investing',
  updated_at = NOW()
WHERE topic_cluster_id IN (11);

-- Statement 35: Technology > Photography & Video > Camera Gear & Photography Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Camera Gear & Photography Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (12);

-- Statement 36: Technology > Photography & Video > Drone Flying & Aerial Photography (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Drone Flying & Aerial Photography',
  updated_at = NOW()
WHERE topic_cluster_id IN (41);

-- Statement 37: Technology > Photography & Video > Photography Accessories & Gear (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Photography Accessories & Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (114);

-- Statement 38: Technology > Photography & Video > Action Camera Reviews & Tests (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Action Camera Reviews & Tests',
  updated_at = NOW()
WHERE topic_cluster_id IN (143);

-- Statement 39: Education > Language Learning > Spanish Language Learning (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Spanish Language Learning',
  updated_at = NOW()
WHERE topic_cluster_id IN (13);

-- Statement 40: Education > Language Learning > Language Learning Tips & Resources (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Language Learning Tips & Resources',
  updated_at = NOW()
WHERE topic_cluster_id IN (172);

-- Statement 41: Education > Language Learning > Polyglot Tips & Multiple Languages (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Polyglot Tips & Multiple Languages',
  updated_at = NOW()
WHERE topic_cluster_id IN (208);

-- Statement 42: Business > Entrepreneurship > Business Scaling & Entrepreneurship (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Entrepreneurship',
  topic_micro = 'Business Scaling & Entrepreneurship',
  updated_at = NOW()
WHERE topic_cluster_id IN (16);

-- Statement 43: Business > Entrepreneurship > Business Growth & Scaling Strategies (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Entrepreneurship',
  topic_micro = 'Business Growth & Scaling Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (168);

-- Statement 44: Technology > AI & Innovation > AI Tools & Technology News (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'AI & Innovation',
  topic_micro = 'AI Tools & Technology News',
  updated_at = NOW()
WHERE topic_cluster_id IN (17);

-- Statement 45: Technology > AI & Innovation > Future Tech & Innovation Trends (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'AI & Innovation',
  topic_micro = 'Future Tech & Innovation Trends',
  updated_at = NOW()
WHERE topic_cluster_id IN (202);

-- Statement 46: Gaming > Gameplay > Live Stream Gaming & Tech (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Live Stream Gaming & Tech',
  updated_at = NOW()
WHERE topic_cluster_id IN (18);

-- Statement 47: Gaming > Gameplay > Minecraft Gameplay & Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Minecraft Gameplay & Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (20);

-- Statement 48: Gaming > Gameplay > Gaming News & Industry Updates (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming News & Industry Updates',
  updated_at = NOW()
WHERE topic_cluster_id IN (93);

-- Statement 49: Gaming > Gameplay > Gaming Commentary & Let's Plays (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Commentary & Let''s Plays',
  updated_at = NOW()
WHERE topic_cluster_id IN (99);

-- Statement 50: Gaming > Gameplay > Gaming Challenges & Competitions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Challenges & Competitions',
  updated_at = NOW()
WHERE topic_cluster_id IN (109);

-- Statement 51: Gaming > Gameplay > Esports & Competitive Gaming (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Esports & Competitive Gaming',
  updated_at = NOW()
WHERE topic_cluster_id IN (111);

-- Statement 52: Gaming > Gameplay > Fortnite Gameplay & Strategies (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Fortnite Gameplay & Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (135);

-- Statement 53: Gaming > Gameplay > Gaming Tutorials & Walkthroughs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Tutorials & Walkthroughs',
  updated_at = NOW()
WHERE topic_cluster_id IN (163);

-- Statement 54: Food & Cooking > Recipes > Food & Cooking Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Food & Cooking Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (19);

-- Statement 55: Food & Cooking > Recipes > Meal Prep & Healthy Eating (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Meal Prep & Healthy Eating',
  updated_at = NOW()
WHERE topic_cluster_id IN (23);

-- Statement 56: Food & Cooking > Recipes > Nutrition & Healthy Recipes (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Nutrition & Healthy Recipes',
  updated_at = NOW()
WHERE topic_cluster_id IN (84);

-- Statement 57: Education > Academic Subjects > Art History & Cultural Education (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Art History & Cultural Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (21);

-- Statement 58: Education > Academic Subjects > Study Tips & Academic Success (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Study Tips & Academic Success',
  updated_at = NOW()
WHERE topic_cluster_id IN (30);

-- Statement 59: Education > Academic Subjects > Science Experiments & STEM Education (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Science Experiments & STEM Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (40);

-- Statement 60: Education > Academic Subjects > History Documentaries & Education (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'History Documentaries & Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (46);

-- Statement 61: Education > Academic Subjects > Scientific Demonstrations & Education (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Scientific Demonstrations & Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (100);

-- Statement 62: Education > Academic Subjects > Chemistry & Science Experiments (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Chemistry & Science Experiments',
  updated_at = NOW()
WHERE topic_cluster_id IN (133);

-- Statement 63: Technology > 3D Printing > 3D Printing Projects & Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = '3D Printing',
  topic_micro = '3D Printing Projects & Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (22);

-- Statement 64: Technology > 3D Printing > 3D Printing Technology & Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = '3D Printing',
  topic_micro = '3D Printing Technology & Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (97);

-- Statement 65: Hobbies > LEGO > LEGO Building & Set Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO',
  topic_micro = 'LEGO Building & Set Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (24);

-- Statement 66: Arts & Media > Photo Editing > Photography Editing & Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Photo Editing',
  topic_micro = 'Photography Editing & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (25);

-- Statement 67: Travel > Adventure Travel > Adventure Travel & Exploration (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Adventure Travel & Exploration',
  updated_at = NOW()
WHERE topic_cluster_id IN (26);

-- Statement 68: Travel > Adventure Travel > Travel Adventures & Culture (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Travel Adventures & Culture',
  updated_at = NOW()
WHERE topic_cluster_id IN (49);

-- Statement 69: Travel > Adventure Travel > Adventure Planning & Travel Prep (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Adventure Planning & Travel Prep',
  updated_at = NOW()
WHERE topic_cluster_id IN (199);

-- Statement 70: Lifestyle > Other > Personal Development & Life Coaching (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Personal Development & Life Coaching',
  updated_at = NOW()
WHERE topic_cluster_id IN (27);

-- Statement 71: Lifestyle > Other > Christian Faith & Bible Study (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Christian Faith & Bible Study',
  updated_at = NOW()
WHERE topic_cluster_id IN (31);

-- Statement 72: Lifestyle > Other > Budget Living & Frugal Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Budget Living & Frugal Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (50);

-- Statement 73: Lifestyle > Other > Inspirational Content & Life Stories (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Inspirational Content & Life Stories',
  updated_at = NOW()
WHERE topic_cluster_id IN (67);

-- Statement 74: Lifestyle > Other > Micro Living & Tiny Apartments (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Micro Living & Tiny Apartments',
  updated_at = NOW()
WHERE topic_cluster_id IN (121);

-- Statement 75: Lifestyle > Other > Spiritual Growth & Faith Journey (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Spiritual Growth & Faith Journey',
  updated_at = NOW()
WHERE topic_cluster_id IN (162);

-- Statement 76: Lifestyle > Other > Alternative Housing & Off-Grid Living (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Alternative Housing & Off-Grid Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (164);

-- Statement 77: Lifestyle > Other > Life Philosophy & Deep Thoughts (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Life Philosophy & Deep Thoughts',
  updated_at = NOW()
WHERE topic_cluster_id IN (195);

-- Statement 78: Technology > Gaming Tech > Gaming Hardware & PC Building (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Gaming Tech',
  topic_micro = 'Gaming Hardware & PC Building',
  updated_at = NOW()
WHERE topic_cluster_id IN (28);

-- Statement 79: Music > Music Production > Professional Music Production (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Professional Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (29);

-- Statement 80: Music > Music Production > Professional Audio Engineering (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Professional Audio Engineering',
  updated_at = NOW()
WHERE topic_cluster_id IN (79);

-- Statement 81: Music > Music Production > Electronic Music Production (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Electronic Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (83);

-- Statement 82: Music > Music Production > Music Recording & Studio Setup (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Music Recording & Studio Setup',
  updated_at = NOW()
WHERE topic_cluster_id IN (89);

-- Statement 83: Business > Other > Motivational Speaking & Leadership (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Motivational Speaking & Leadership',
  updated_at = NOW()
WHERE topic_cluster_id IN (32);

-- Statement 84: Business > Other > Restaurant Business & Food Industry (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Restaurant Business & Food Industry',
  updated_at = NOW()
WHERE topic_cluster_id IN (101);

-- Statement 85: Business > Other > Real Estate Agent Training & Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Real Estate Agent Training & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (128);

-- Statement 86: Business > Other > Public Speaking & Communication (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Public Speaking & Communication',
  updated_at = NOW()
WHERE topic_cluster_id IN (129);

-- Statement 87: Business > Other > Passive Income & Side Hustles (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Passive Income & Side Hustles',
  updated_at = NOW()
WHERE topic_cluster_id IN (145);

-- Statement 88: Business > Other > Content Strategy & Channel Growth (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Content Strategy & Channel Growth',
  updated_at = NOW()
WHERE topic_cluster_id IN (212);

-- Statement 89: DIY & Crafts > Digital Fabrication > Laser Cutting & CNC Projects (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Digital Fabrication',
  topic_micro = 'Laser Cutting & CNC Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (35);

-- Statement 90: Travel > Destination Guides > Travel Planning & Destination Guides (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Destination Guides',
  topic_micro = 'Travel Planning & Destination Guides',
  updated_at = NOW()
WHERE topic_cluster_id IN (37);

-- Statement 91: Travel > Destination Guides > Travel Tips & Destination Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Destination Guides',
  topic_micro = 'Travel Tips & Destination Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (105);

-- Statement 92: Education > Educational Content > Educational Documentary Content (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Educational Documentary Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (38);

-- Statement 93: Education > Educational Content > Educational Explainer Videos (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Educational Explainer Videos',
  updated_at = NOW()
WHERE topic_cluster_id IN (74);

-- Statement 94: Education > Educational Content > Medical Education & Health Facts (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Medical Education & Health Facts',
  updated_at = NOW()
WHERE topic_cluster_id IN (147);

-- Statement 95: Education > Educational Content > Coding Bootcamps & Tech Education (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Coding Bootcamps & Tech Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (171);

-- Statement 96: Education > Educational Content > Effective Study Methods & Learning (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Effective Study Methods & Learning',
  updated_at = NOW()
WHERE topic_cluster_id IN (186);

-- Statement 97: Education > Educational Content > Cultural Education & World Awareness (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Cultural Education & World Awareness',
  updated_at = NOW()
WHERE topic_cluster_id IN (200);

-- Statement 98: Education > Educational Content > Art Education & Teaching Methods (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Art Education & Teaching Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (203);

-- Statement 99: Education > Educational Content > Scientific Art & STEAM Projects (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Scientific Art & STEAM Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (213);

-- Statement 100: Education > Educational Content > Global Perspectives & World Views (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Global Perspectives & World Views',
  updated_at = NOW()
WHERE topic_cluster_id IN (215);

-- Statement 101: Home & Garden > Renovation > Home Renovation & Improvement (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Renovation',
  topic_micro = 'Home Renovation & Improvement',
  updated_at = NOW()
WHERE topic_cluster_id IN (39);

-- Statement 102: Business > E-commerce > Online Business & Passive Income (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'Online Business & Passive Income',
  updated_at = NOW()
WHERE topic_cluster_id IN (42);

-- Statement 103: Business > E-commerce > E-commerce & Amazon FBA (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'E-commerce & Amazon FBA',
  updated_at = NOW()
WHERE topic_cluster_id IN (68);

-- Statement 104: Business > E-commerce > Amazon Business & E-commerce Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'Amazon Business & E-commerce Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (158);

-- Statement 105: Business > E-commerce > E-commerce Strategies & Online Sales (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'E-commerce Strategies & Online Sales',
  updated_at = NOW()
WHERE topic_cluster_id IN (193);

-- Statement 106: Technology > Tech Industry > Tech Industry News & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Tech Industry',
  topic_micro = 'Tech Industry News & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (43);

-- Statement 107: Technology > Tech Industry > Tech News & Industry Updates (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Tech Industry',
  topic_micro = 'Tech News & Industry Updates',
  updated_at = NOW()
WHERE topic_cluster_id IN (122);

-- Statement 108: Lifestyle > Family Life > Family Vlogs & Parenting (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Family Life',
  topic_micro = 'Family Vlogs & Parenting',
  updated_at = NOW()
WHERE topic_cluster_id IN (44);

-- Statement 109: Lifestyle > Family Life > Mom Life & Family Organization (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Family Life',
  topic_micro = 'Mom Life & Family Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (136);

-- Statement 110: Outdoors > Camping > Outdoor Adventure & Camping (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Camping',
  topic_micro = 'Outdoor Adventure & Camping',
  updated_at = NOW()
WHERE topic_cluster_id IN (45);

-- Statement 111: Education > Other > Historical Analysis & Storytelling (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Other',
  topic_micro = 'Historical Analysis & Storytelling',
  updated_at = NOW()
WHERE topic_cluster_id IN (47);

-- Statement 112: Entertainment > True Crime > Mystery & True Crime Content (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'True Crime',
  topic_micro = 'Mystery & True Crime Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (48);

-- Statement 113: Home & Garden > Organization > Home Storage & Organization Solutions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Organization',
  topic_micro = 'Home Storage & Organization Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (52);

-- Statement 114: Business > Creative Business > Professional Photography Business (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Creative Business',
  topic_micro = 'Professional Photography Business',
  updated_at = NOW()
WHERE topic_cluster_id IN (53);

-- Statement 115: Lifestyle > Fashion & Beauty > Daily Vlogs & Lifestyle Content (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Daily Vlogs & Lifestyle Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (54);

-- Statement 116: Lifestyle > Fashion & Beauty > Simple Living & Lifestyle Design (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Simple Living & Lifestyle Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (126);

-- Statement 117: Lifestyle > Fashion & Beauty > Lifestyle Transformation & Habits (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Lifestyle Transformation & Habits',
  updated_at = NOW()
WHERE topic_cluster_id IN (181);

-- Statement 118: Lifestyle > Fashion & Beauty > Lifestyle Optimization & Efficiency (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Lifestyle Optimization & Efficiency',
  updated_at = NOW()
WHERE topic_cluster_id IN (205);

-- Statement 119: Music > Performance > Music Performance & Covers (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Performance',
  topic_micro = 'Music Performance & Covers',
  updated_at = NOW()
WHERE topic_cluster_id IN (55);

-- Statement 120: Music > Performance > Live Music & Concert Coverage (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Performance',
  topic_micro = 'Live Music & Concert Coverage',
  updated_at = NOW()
WHERE topic_cluster_id IN (211);

-- Statement 121: Lifestyle > Wellness > Personal Growth & Mindfulness (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Wellness',
  topic_micro = 'Personal Growth & Mindfulness',
  updated_at = NOW()
WHERE topic_cluster_id IN (56);

-- Statement 122: DIY & Crafts > Metalworking > Metalworking & Knife Making (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Metalworking & Knife Making',
  updated_at = NOW()
WHERE topic_cluster_id IN (57);

-- Statement 123: DIY & Crafts > Metalworking > Professional Knife Making & Bladesmithing (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Professional Knife Making & Bladesmithing',
  updated_at = NOW()
WHERE topic_cluster_id IN (167);

-- Statement 124: DIY & Crafts > Metalworking > Advanced Metalworking & Fabrication (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Advanced Metalworking & Fabrication',
  updated_at = NOW()
WHERE topic_cluster_id IN (170);

-- Statement 125: Sports > Extreme Sports > Adventure Sports & Extreme Activities (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Extreme Sports',
  topic_micro = 'Adventure Sports & Extreme Activities',
  updated_at = NOW()
WHERE topic_cluster_id IN (58);

-- Statement 126: Technology > Programming > Programming & Coding Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Programming & Coding Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (59);

-- Statement 127: Technology > Programming > Python Programming & Data Science (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Python Programming & Data Science',
  updated_at = NOW()
WHERE topic_cluster_id IN (165);

-- Statement 128: Technology > Programming > Web Development & JavaScript (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Web Development & JavaScript',
  updated_at = NOW()
WHERE topic_cluster_id IN (175);

-- Statement 129: Technology > Programming > Full-Stack Development & Coding (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Full-Stack Development & Coding',
  updated_at = NOW()
WHERE topic_cluster_id IN (183);

-- Statement 130: Entertainment > Pop Culture > Entertainment News & Pop Culture (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Pop Culture',
  topic_micro = 'Entertainment News & Pop Culture',
  updated_at = NOW()
WHERE topic_cluster_id IN (60);

-- Statement 131: Food & Cooking > Food Reviews > Restaurant Reviews & Food Tours (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Food Reviews',
  topic_micro = 'Restaurant Reviews & Food Tours',
  updated_at = NOW()
WHERE topic_cluster_id IN (61);

-- Statement 132: Lifestyle > Daily Vlogs > Morning Routines & Productivity (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Daily Vlogs',
  topic_micro = 'Morning Routines & Productivity',
  updated_at = NOW()
WHERE topic_cluster_id IN (62);

-- Statement 133: News & Politics > Current Events > World News & Current Events (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'Current Events',
  topic_micro = 'World News & Current Events',
  updated_at = NOW()
WHERE topic_cluster_id IN (65);

-- Statement 134: Outdoors > Gear Reviews > Camping Gear Reviews & Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Gear Reviews',
  topic_micro = 'Camping Gear Reviews & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (66);

-- Statement 135: Arts & Media > Painting > Painting Techniques & Art Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Painting',
  topic_micro = 'Painting Techniques & Art Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (69);

-- Statement 136: Home & Garden > Home Repair > Home Repairs & Maintenance (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Home Repair',
  topic_micro = 'Home Repairs & Maintenance',
  updated_at = NOW()
WHERE topic_cluster_id IN (70);

-- Statement 137: Finance > Real Estate > Real Estate Investment Strategies (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Real Estate',
  topic_micro = 'Real Estate Investment Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (71);

-- Statement 138: Home & Garden > Bathrooms > Bathroom Renovations & Plumbing (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Bathrooms',
  topic_micro = 'Bathroom Renovations & Plumbing',
  updated_at = NOW()
WHERE topic_cluster_id IN (72);

-- Statement 139: Travel > Other > RV Life & Mobile Living (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Other',
  topic_micro = 'RV Life & Mobile Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (73);

-- Statement 140: Entertainment > Star Wars > Star Wars Fan Content & Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Star Wars',
  topic_micro = 'Star Wars Fan Content & Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (75);

-- Statement 141: Outdoors > Survival > Outdoor Survival & Bushcraft (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Survival',
  topic_micro = 'Outdoor Survival & Bushcraft',
  updated_at = NOW()
WHERE topic_cluster_id IN (76);

-- Statement 142: Music > Music Gear > Music Gear Reviews & Demos (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Gear',
  topic_micro = 'Music Gear Reviews & Demos',
  updated_at = NOW()
WHERE topic_cluster_id IN (77);

-- Statement 143: Music > Music Gear > Professional Music Equipment (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Gear',
  topic_micro = 'Professional Music Equipment',
  updated_at = NOW()
WHERE topic_cluster_id IN (94);

-- Statement 144: Home & Garden > Kitchens > Kitchen Design & Renovation (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Kitchens',
  topic_micro = 'Kitchen Design & Renovation',
  updated_at = NOW()
WHERE topic_cluster_id IN (78);

-- Statement 145: Arts & Media > Art Education > Art Techniques & Creative Process (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Art Education',
  topic_micro = 'Art Techniques & Creative Process',
  updated_at = NOW()
WHERE topic_cluster_id IN (80);

-- Statement 146: Home & Garden > Small Spaces > Small Space Design Solutions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Small Spaces',
  topic_micro = 'Small Space Design Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (81);

-- Statement 147: News & Politics > Political Analysis > Political Commentary & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'Political Analysis',
  topic_micro = 'Political Commentary & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (86);

-- Statement 148: Outdoors > Winter Activities > Winter Camping & Cold Weather Gear (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Winter Activities',
  topic_micro = 'Winter Camping & Cold Weather Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (87);

-- Statement 149: Arts & Media > Photography Projects > Creative Photography Projects (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Photography Projects',
  topic_micro = 'Creative Photography Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (88);

-- Statement 150: News & Politics > World News > International News & Global Affairs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'World News',
  topic_micro = 'International News & Global Affairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (92);

-- Statement 151: Entertainment > Comedy > Comedy Sketches & Entertainment (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Comedy',
  topic_micro = 'Comedy Sketches & Entertainment',
  updated_at = NOW()
WHERE topic_cluster_id IN (95);

-- Statement 152: Hobbies > LEGO Technic > LEGO Technic & Advanced Builds (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO Technic',
  topic_micro = 'LEGO Technic & Advanced Builds',
  updated_at = NOW()
WHERE topic_cluster_id IN (96);

-- Statement 153: Sports > Sports History > Sports History & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Sports History',
  topic_micro = 'Sports History & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (98);

-- Statement 154: Finance > Trading > Stock Trading Strategies & Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Trading',
  topic_micro = 'Stock Trading Strategies & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (102);

-- Statement 155: Finance > Market Analysis > Real Estate Market Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Market Analysis',
  topic_micro = 'Real Estate Market Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (103);

-- Statement 156: DIY & Crafts > Home DIY > DIY Home Projects & Repairs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Home DIY',
  topic_micro = 'DIY Home Projects & Repairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (104);

-- Statement 157: Finance > Personal Finance > Personal Finance & Money Management (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Personal Finance',
  topic_micro = 'Personal Finance & Money Management',
  updated_at = NOW()
WHERE topic_cluster_id IN (106);

-- Statement 158: Outdoors > Equipment > Outdoor Gear & Equipment Reviews (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Equipment',
  topic_micro = 'Outdoor Gear & Equipment Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (107);

-- Statement 159: Hobbies > Card Games > Trading Card Games & Collectibles (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Card Games',
  topic_micro = 'Trading Card Games & Collectibles',
  updated_at = NOW()
WHERE topic_cluster_id IN (108);

-- Statement 160: Arts & Media > Drawing > Drawing Tutorials & Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Drawing',
  topic_micro = 'Drawing Tutorials & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (110);

-- Statement 161: Technology > Electronics > Robotics Projects & Engineering (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Robotics Projects & Engineering',
  updated_at = NOW()
WHERE topic_cluster_id IN (112);

-- Statement 162: Technology > Electronics > Electronics Projects & Arduino (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Electronics Projects & Arduino',
  updated_at = NOW()
WHERE topic_cluster_id IN (132);

-- Statement 163: Technology > Electronics > Electronics Assembly & Soldering (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Electronics Assembly & Soldering',
  updated_at = NOW()
WHERE topic_cluster_id IN (155);

-- Statement 164: Technology > Electronics > Advanced Electronics & Circuit Design (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Advanced Electronics & Circuit Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (159);

-- Statement 165: Automotive > Car Repair > Auto Repair & Car Maintenance (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Automotive',
  topic_niche = 'Car Repair',
  topic_micro = 'Auto Repair & Car Maintenance',
  updated_at = NOW()
WHERE topic_cluster_id IN (113);

-- Statement 166: Home & Garden > Wall Repair > Drywall & Ceiling Repairs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Wall Repair',
  topic_micro = 'Drywall & Ceiling Repairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (115);

-- Statement 167: DIY & Crafts > Crafts > Epoxy Resin Art & Tables (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Crafts',
  topic_micro = 'Epoxy Resin Art & Tables',
  updated_at = NOW()
WHERE topic_cluster_id IN (116);

-- Statement 168: DIY & Crafts > Crafts > Artisan Crafts & Handmade Goods (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Crafts',
  topic_micro = 'Artisan Crafts & Handmade Goods',
  updated_at = NOW()
WHERE topic_cluster_id IN (197);

-- Statement 169: DIY & Crafts > Sewing & Textiles > Sewing Projects & Fashion DIY (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Sewing & Textiles',
  topic_micro = 'Sewing Projects & Fashion DIY',
  updated_at = NOW()
WHERE topic_cluster_id IN (118);

-- Statement 170: Entertainment > Star Wars Lore > Star Wars Lore & Deep Dives (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Star Wars Lore',
  topic_micro = 'Star Wars Lore & Deep Dives',
  updated_at = NOW()
WHERE topic_cluster_id IN (119);

-- Statement 171: Education > Skills Training > Educational Series & Crash Courses (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Skills Training',
  topic_micro = 'Educational Series & Crash Courses',
  updated_at = NOW()
WHERE topic_cluster_id IN (120);

-- Statement 172: Business > Business Strategy > Business Strategy & Management (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Business Strategy',
  topic_micro = 'Business Strategy & Management',
  updated_at = NOW()
WHERE topic_cluster_id IN (123);

-- Statement 173: Finance > Housing Market > Housing Market Trends & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Housing Market',
  topic_micro = 'Housing Market Trends & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (127);

-- Statement 174: Entertainment > Creator Content > YouTube Milestones & Celebrations (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Creator Content',
  topic_micro = 'YouTube Milestones & Celebrations',
  updated_at = NOW()
WHERE topic_cluster_id IN (130);

-- Statement 175: Health & Wellness > Eye Care > Eye Health & Vision Care (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Health & Wellness',
  topic_niche = 'Eye Care',
  topic_micro = 'Eye Health & Vision Care',
  updated_at = NOW()
WHERE topic_cluster_id IN (131);

-- Statement 176: Hobbies > Pokemon Cards > Pokemon Card Collecting & Opening (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Pokemon Cards',
  topic_micro = 'Pokemon Card Collecting & Opening',
  updated_at = NOW()
WHERE topic_cluster_id IN (134);

-- Statement 177: Outdoors > Winter Sports > Winter Outdoor Adventures (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Winter Sports',
  topic_micro = 'Winter Outdoor Adventures',
  updated_at = NOW()
WHERE topic_cluster_id IN (137);

-- Statement 178: DIY & Crafts > Other > RV Renovations & Upgrades (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Other',
  topic_micro = 'RV Renovations & Upgrades',
  updated_at = NOW()
WHERE topic_cluster_id IN (138);

-- Statement 179: DIY & Crafts > Other > Tiny House Building & Design (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Other',
  topic_micro = 'Tiny House Building & Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (204);

-- Statement 180: Arts & Media > Art History > Art History & Technique Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Art History',
  topic_micro = 'Art History & Technique Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (139);

-- Statement 181: Arts & Media > Painting Tutorials > Step-by-Step Painting Tutorials (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Painting Tutorials',
  topic_micro = 'Step-by-Step Painting Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (140);

-- Statement 182: Hobbies > LEGO Collecting > LEGO Star Wars Collections (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO Collecting',
  topic_micro = 'LEGO Star Wars Collections',
  updated_at = NOW()
WHERE topic_cluster_id IN (141);

-- Statement 183: Sports > Formula 1 > Formula 1 Racing & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Formula 1',
  topic_micro = 'Formula 1 Racing & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (142);

-- Statement 184: Health & Fitness > Other > Bodybuilding & Muscle Growth (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Other',
  topic_micro = 'Bodybuilding & Muscle Growth',
  updated_at = NOW()
WHERE topic_cluster_id IN (144);

-- Statement 185: Sports > Martial Arts > Martial Arts Training & Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Martial Arts',
  topic_micro = 'Martial Arts Training & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (146);

-- Statement 186: Entertainment > Slow Motion > Slow Motion Science & Experiments (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Slow Motion',
  topic_micro = 'Slow Motion Science & Experiments',
  updated_at = NOW()
WHERE topic_cluster_id IN (148);

-- Statement 187: Hobbies > Cosplay > Prop Making & 3D Printed Cosplay (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Cosplay',
  topic_micro = 'Prop Making & 3D Printed Cosplay',
  updated_at = NOW()
WHERE topic_cluster_id IN (149);

-- Statement 188: Sports > College Football > College Football Coverage & Analysis (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'College Football',
  topic_micro = 'College Football Coverage & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (150);

-- Statement 189: Home & Garden > Bathroom Design > Bathroom Design & Renovation Ideas (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Bathroom Design',
  topic_micro = 'Bathroom Design & Renovation Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (151);

-- Statement 190: Music > Other > Music Reaction Videos & Commentary (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Other',
  topic_micro = 'Music Reaction Videos & Commentary',
  updated_at = NOW()
WHERE topic_cluster_id IN (152);

-- Statement 191: Music > Other > Professional Audio Production Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Other',
  topic_micro = 'Professional Audio Production Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (194);

-- Statement 192: Technology > Mobile & Computing > iOS Tips & Apple Ecosystem (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Mobile & Computing',
  topic_micro = 'iOS Tips & Apple Ecosystem',
  updated_at = NOW()
WHERE topic_cluster_id IN (154);

-- Statement 193: Home & Garden > Kitchen Storage > Kitchen Organization & Storage Hacks (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Kitchen Storage',
  topic_micro = 'Kitchen Organization & Storage Hacks',
  updated_at = NOW()
WHERE topic_cluster_id IN (156);

-- Statement 194: Entertainment > Live Interaction > Live Q&A Sessions & Community (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Live Interaction',
  topic_micro = 'Live Q&A Sessions & Community',
  updated_at = NOW()
WHERE topic_cluster_id IN (157);

-- Statement 195: Arts & Media > Videography > Professional Videography & Filming (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Videography',
  topic_micro = 'Professional Videography & Filming',
  updated_at = NOW()
WHERE topic_cluster_id IN (161);

-- Statement 196: Home & Garden > Custom Storage > Custom Storage Solutions & Built-ins (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Custom Storage',
  topic_micro = 'Custom Storage Solutions & Built-ins',
  updated_at = NOW()
WHERE topic_cluster_id IN (166);

-- Statement 197: Arts & Media > Digital Art > Digital Art & Illustration Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Digital Art',
  topic_micro = 'Digital Art & Illustration Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (169);

-- Statement 198: Finance > Wealth Building > Investment Strategies & Wealth Building (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Wealth Building',
  topic_micro = 'Investment Strategies & Wealth Building',
  updated_at = NOW()
WHERE topic_cluster_id IN (174);

-- Statement 199: DIY & Crafts > Workshop > Workshop Organization & Tool Storage (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Workshop Organization & Tool Storage',
  updated_at = NOW()
WHERE topic_cluster_id IN (176);

-- Statement 200: DIY & Crafts > Workshop > Professional Tool Reviews & Comparisons (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Professional Tool Reviews & Comparisons',
  updated_at = NOW()
WHERE topic_cluster_id IN (179);

-- Statement 201: DIY & Crafts > Workshop > Specialty Tool Making & Jigs (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Specialty Tool Making & Jigs',
  updated_at = NOW()
WHERE topic_cluster_id IN (191);

-- Statement 202: DIY & Crafts > Workshop > Custom Jigs & Workshop Solutions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Custom Jigs & Workshop Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (196);

-- Statement 203: DIY & Crafts > Workshop > Home Workshop Setup & Organization (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Home Workshop Setup & Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (210);

-- Statement 204: DIY & Crafts > Workshop > Professional Workshop Equipment (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Professional Workshop Equipment',
  updated_at = NOW()
WHERE topic_cluster_id IN (214);

-- Statement 205: Arts & Media > Documentary > Documentary Filmmaking & Storytelling (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Documentary',
  topic_micro = 'Documentary Filmmaking & Storytelling',
  updated_at = NOW()
WHERE topic_cluster_id IN (177);

-- Statement 206: Home & Garden > Space Saving > Space-Saving Furniture & Solutions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Space Saving',
  topic_micro = 'Space-Saving Furniture & Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (180);

-- Statement 207: Home & Garden > Modular Storage > Modular Storage Systems & Organization (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Modular Storage',
  topic_micro = 'Modular Storage Systems & Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (182);

-- Statement 208: Music > Music Business > Professional Music Industry Insights (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Business',
  topic_micro = 'Professional Music Industry Insights',
  updated_at = NOW()
WHERE topic_cluster_id IN (184);

-- Statement 209: Music > Music Business > Music Business & Industry Tips (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Business',
  topic_micro = 'Music Business & Industry Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (188);

-- Statement 210: Arts & Media > Mixed Media > Mixed Media Art & Experimental Techniques (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Mixed Media',
  topic_micro = 'Mixed Media Art & Experimental Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (187);

-- Statement 211: Home & Garden > Creative Storage > Creative Storage & Organization Ideas (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Creative Storage',
  topic_micro = 'Creative Storage & Organization Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (189);

-- Statement 212: Arts & Media > Traditional Art > Traditional Art Techniques & Methods (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Traditional Art',
  topic_micro = 'Traditional Art Techniques & Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (190);

-- Statement 213: Travel > Cultural Travel > Global Travel & Cultural Experiences (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Cultural Travel',
  topic_micro = 'Global Travel & Cultural Experiences',
  updated_at = NOW()
WHERE topic_cluster_id IN (192);

-- Statement 214: Home & Garden > Custom Shelving > Custom Shelving & Display Solutions (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Custom Shelving',
  topic_micro = 'Custom Shelving & Display Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (206);

-- Statement 215: Outdoors > Extreme Camping > Extreme Weather Camping & Gear (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Extreme Camping',
  topic_micro = 'Extreme Weather Camping & Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (207);

-- Statement 216: Music > Music Theory > Music Theory & Composition (1 clusters)
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Theory',
  topic_micro = 'Music Theory & Composition',
  updated_at = NOW()
WHERE topic_cluster_id IN (209);


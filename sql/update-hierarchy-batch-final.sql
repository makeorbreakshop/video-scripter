-- BERTopic Hierarchy Update
-- Generated: 2025-08-04T10:53:49.635Z
-- Total update statements: 216

BEGIN;


-- Update DIY & Crafts > Woodworking > Woodworking Projects & Tool Reviews
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Woodworking Projects & Tool Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (0);


-- Update DIY & Crafts > Woodworking > Creative Woodworking Ideas
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Creative Woodworking Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (15);


-- Update DIY & Crafts > Woodworking > Furniture Making & Wood Design
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Furniture Making & Wood Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (51);


-- Update DIY & Crafts > Woodworking > Cabinet Making & Fine Woodworking
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Cabinet Making & Fine Woodworking',
  updated_at = NOW()
WHERE topic_cluster_id IN (64);


-- Update DIY & Crafts > Woodworking > Epoxy River Tables & Furniture
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Epoxy River Tables & Furniture',
  updated_at = NOW()
WHERE topic_cluster_id IN (124);


-- Update DIY & Crafts > Woodworking > Handmade Cutting Boards & Crafts
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Handmade Cutting Boards & Crafts',
  updated_at = NOW()
WHERE topic_cluster_id IN (153);


-- Update DIY & Crafts > Woodworking > Precision Woodworking & Joinery
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Precision Woodworking & Joinery',
  updated_at = NOW()
WHERE topic_cluster_id IN (173);


-- Update DIY & Crafts > Woodworking > Unique Furniture Designs & Builds
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Unique Furniture Designs & Builds',
  updated_at = NOW()
WHERE topic_cluster_id IN (178);


-- Update DIY & Crafts > Woodworking > Advanced Woodworking Techniques
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Woodworking',
  topic_micro = 'Advanced Woodworking Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (185);


-- Update Business > Finance & Trading > AI Business & Stock Trading
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Finance & Trading',
  topic_micro = 'AI Business & Stock Trading',
  updated_at = NOW()
WHERE topic_cluster_id IN (1);


-- Update Lifestyle > Home & Organization > Home Cleaning & Organization Routines
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Home Cleaning & Organization Routines',
  updated_at = NOW()
WHERE topic_cluster_id IN (2);


-- Update Lifestyle > Home & Organization > Minimalist Lifestyle & Decluttering
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Minimalist Lifestyle & Decluttering',
  updated_at = NOW()
WHERE topic_cluster_id IN (36);


-- Update Lifestyle > Home & Organization > Extreme Decluttering & Minimalism
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Extreme Decluttering & Minimalism',
  updated_at = NOW()
WHERE topic_cluster_id IN (117);


-- Update Lifestyle > Home & Organization > Deep Cleaning & Organization Methods
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Home & Organization',
  topic_micro = 'Deep Cleaning & Organization Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (160);


-- Update Health & Fitness > Workouts > Running & Fitness Training
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Workouts',
  topic_micro = 'Running & Fitness Training',
  updated_at = NOW()
WHERE topic_cluster_id IN (3);


-- Update Health & Fitness > Workouts > Fitness Challenges & Workouts
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Workouts',
  topic_micro = 'Fitness Challenges & Workouts',
  updated_at = NOW()
WHERE topic_cluster_id IN (82);


-- Update Lifestyle > Alternative Living > Tiny Living & Alternative Housing
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Tiny Living & Alternative Housing',
  updated_at = NOW()
WHERE topic_cluster_id IN (4);


-- Update Lifestyle > Alternative Living > Van Life & Nomadic Living
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Van Life & Nomadic Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (125);


-- Update Lifestyle > Alternative Living > Mobile Home & Tiny House Tours
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Alternative Living',
  topic_micro = 'Mobile Home & Tiny House Tours',
  updated_at = NOW()
WHERE topic_cluster_id IN (198);


-- Update Technology > Electric Vehicles > Tesla & Electric Vehicle Reviews
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electric Vehicles',
  topic_micro = 'Tesla & Electric Vehicle Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (5);


-- Update Technology > Electric Vehicles > Tech Product Unboxings
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electric Vehicles',
  topic_micro = 'Tech Product Unboxings',
  updated_at = NOW()
WHERE topic_cluster_id IN (33);


-- Update Music > Instruments > Guitar Tutorials & Music Gear
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Guitar Tutorials & Music Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (6);


-- Update Music > Instruments > Music Theory & Instrument Lessons
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Music Theory & Instrument Lessons',
  updated_at = NOW()
WHERE topic_cluster_id IN (63);


-- Update Music > Instruments > Guitar Gear & Equipment Reviews
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Guitar Gear & Equipment Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (85);


-- Update Music > Instruments > Musical Instrument Reviews
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Instruments',
  topic_micro = 'Musical Instrument Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (91);


-- Update Travel > Theme Parks > Disney Parks & Travel Vlogs
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Theme Parks',
  topic_micro = 'Disney Parks & Travel Vlogs',
  updated_at = NOW()
WHERE topic_cluster_id IN (7);


-- Update Technology > Other > Live Streaming & 3D Content
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Other',
  topic_micro = 'Live Streaming & 3D Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (8);


-- Update Technology > Other > Technology Tutorials & How-To
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Other',
  topic_micro = 'Technology Tutorials & How-To',
  updated_at = NOW()
WHERE topic_cluster_id IN (90);


-- Update Business > Digital Marketing > Instagram Marketing & E-commerce
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Instagram Marketing & E-commerce',
  updated_at = NOW()
WHERE topic_cluster_id IN (9);


-- Update Business > Digital Marketing > YouTube Channel Growth Strategies
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'YouTube Channel Growth Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (14);


-- Update Business > Digital Marketing > Content Creation Tools & Tips
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Content Creation Tools & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (34);


-- Update Business > Digital Marketing > Photography Business & Marketing
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Digital Marketing',
  topic_micro = 'Photography Business & Marketing',
  updated_at = NOW()
WHERE topic_cluster_id IN (201);


-- Update Technology > Audio Technology > Audio Equipment & Music Production
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Audio Technology',
  topic_micro = 'Audio Equipment & Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (10);


-- Update Finance > Investing > Stock Market & Real Estate Investing
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Investing',
  topic_micro = 'Stock Market & Real Estate Investing',
  updated_at = NOW()
WHERE topic_cluster_id IN (11);


-- Update Technology > Photography & Video > Camera Gear & Photography Reviews
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Camera Gear & Photography Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (12);


-- Update Technology > Photography & Video > Drone Flying & Aerial Photography
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Drone Flying & Aerial Photography',
  updated_at = NOW()
WHERE topic_cluster_id IN (41);


-- Update Technology > Photography & Video > Photography Accessories & Gear
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Photography Accessories & Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (114);


-- Update Technology > Photography & Video > Action Camera Reviews & Tests
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Photography & Video',
  topic_micro = 'Action Camera Reviews & Tests',
  updated_at = NOW()
WHERE topic_cluster_id IN (143);


-- Update Education > Language Learning > Spanish Language Learning
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Spanish Language Learning',
  updated_at = NOW()
WHERE topic_cluster_id IN (13);


-- Update Education > Language Learning > Language Learning Tips & Resources
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Language Learning Tips & Resources',
  updated_at = NOW()
WHERE topic_cluster_id IN (172);


-- Update Education > Language Learning > Polyglot Tips & Multiple Languages
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Language Learning',
  topic_micro = 'Polyglot Tips & Multiple Languages',
  updated_at = NOW()
WHERE topic_cluster_id IN (208);


-- Update Business > Entrepreneurship > Business Scaling & Entrepreneurship
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Entrepreneurship',
  topic_micro = 'Business Scaling & Entrepreneurship',
  updated_at = NOW()
WHERE topic_cluster_id IN (16);


-- Update Business > Entrepreneurship > Business Growth & Scaling Strategies
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Entrepreneurship',
  topic_micro = 'Business Growth & Scaling Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (168);


-- Update Technology > AI & Innovation > AI Tools & Technology News
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'AI & Innovation',
  topic_micro = 'AI Tools & Technology News',
  updated_at = NOW()
WHERE topic_cluster_id IN (17);


-- Update Technology > AI & Innovation > Future Tech & Innovation Trends
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'AI & Innovation',
  topic_micro = 'Future Tech & Innovation Trends',
  updated_at = NOW()
WHERE topic_cluster_id IN (202);


-- Update Gaming > Gameplay > Live Stream Gaming & Tech
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Live Stream Gaming & Tech',
  updated_at = NOW()
WHERE topic_cluster_id IN (18);


-- Update Gaming > Gameplay > Minecraft Gameplay & Tutorials
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Minecraft Gameplay & Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (20);


-- Update Gaming > Gameplay > Gaming News & Industry Updates
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming News & Industry Updates',
  updated_at = NOW()
WHERE topic_cluster_id IN (93);


-- Update Gaming > Gameplay > Gaming Commentary & Let's Plays
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Commentary & Let''s Plays',
  updated_at = NOW()
WHERE topic_cluster_id IN (99);


-- Update Gaming > Gameplay > Gaming Challenges & Competitions
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Challenges & Competitions',
  updated_at = NOW()
WHERE topic_cluster_id IN (109);


-- Update Gaming > Gameplay > Esports & Competitive Gaming
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Esports & Competitive Gaming',
  updated_at = NOW()
WHERE topic_cluster_id IN (111);


-- Update Gaming > Gameplay > Fortnite Gameplay & Strategies
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Fortnite Gameplay & Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (135);


-- Update Gaming > Gameplay > Gaming Tutorials & Walkthroughs
UPDATE videos 
SET 
  topic_domain = 'Gaming',
  topic_niche = 'Gameplay',
  topic_micro = 'Gaming Tutorials & Walkthroughs',
  updated_at = NOW()
WHERE topic_cluster_id IN (163);


-- Update Food & Cooking > Recipes > Food & Cooking Tutorials
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Food & Cooking Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (19);


-- Update Food & Cooking > Recipes > Meal Prep & Healthy Eating
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Meal Prep & Healthy Eating',
  updated_at = NOW()
WHERE topic_cluster_id IN (23);


-- Update Food & Cooking > Recipes > Nutrition & Healthy Recipes
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Recipes',
  topic_micro = 'Nutrition & Healthy Recipes',
  updated_at = NOW()
WHERE topic_cluster_id IN (84);


-- Update Education > Academic Subjects > Art History & Cultural Education
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Art History & Cultural Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (21);


-- Update Education > Academic Subjects > Study Tips & Academic Success
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Study Tips & Academic Success',
  updated_at = NOW()
WHERE topic_cluster_id IN (30);


-- Update Education > Academic Subjects > Science Experiments & STEM Education
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Science Experiments & STEM Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (40);


-- Update Education > Academic Subjects > History Documentaries & Education
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'History Documentaries & Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (46);


-- Update Education > Academic Subjects > Scientific Demonstrations & Education
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Scientific Demonstrations & Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (100);


-- Update Education > Academic Subjects > Chemistry & Science Experiments
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Academic Subjects',
  topic_micro = 'Chemistry & Science Experiments',
  updated_at = NOW()
WHERE topic_cluster_id IN (133);


-- Update Technology > 3D Printing > 3D Printing Projects & Tutorials
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = '3D Printing',
  topic_micro = '3D Printing Projects & Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (22);


-- Update Technology > 3D Printing > 3D Printing Technology & Reviews
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = '3D Printing',
  topic_micro = '3D Printing Technology & Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (97);


-- Update Hobbies > LEGO > LEGO Building & Set Reviews
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO',
  topic_micro = 'LEGO Building & Set Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (24);


-- Update Arts & Media > Photo Editing > Photography Editing & Techniques
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Photo Editing',
  topic_micro = 'Photography Editing & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (25);


-- Update Travel > Adventure Travel > Adventure Travel & Exploration
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Adventure Travel & Exploration',
  updated_at = NOW()
WHERE topic_cluster_id IN (26);


-- Update Travel > Adventure Travel > Travel Adventures & Culture
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Travel Adventures & Culture',
  updated_at = NOW()
WHERE topic_cluster_id IN (49);


-- Update Travel > Adventure Travel > Adventure Planning & Travel Prep
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Adventure Travel',
  topic_micro = 'Adventure Planning & Travel Prep',
  updated_at = NOW()
WHERE topic_cluster_id IN (199);


-- Update Lifestyle > Other > Personal Development & Life Coaching
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Personal Development & Life Coaching',
  updated_at = NOW()
WHERE topic_cluster_id IN (27);


-- Update Lifestyle > Other > Christian Faith & Bible Study
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Christian Faith & Bible Study',
  updated_at = NOW()
WHERE topic_cluster_id IN (31);


-- Update Lifestyle > Other > Budget Living & Frugal Tips
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Budget Living & Frugal Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (50);


-- Update Lifestyle > Other > Inspirational Content & Life Stories
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Inspirational Content & Life Stories',
  updated_at = NOW()
WHERE topic_cluster_id IN (67);


-- Update Lifestyle > Other > Micro Living & Tiny Apartments
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Micro Living & Tiny Apartments',
  updated_at = NOW()
WHERE topic_cluster_id IN (121);


-- Update Lifestyle > Other > Spiritual Growth & Faith Journey
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Spiritual Growth & Faith Journey',
  updated_at = NOW()
WHERE topic_cluster_id IN (162);


-- Update Lifestyle > Other > Alternative Housing & Off-Grid Living
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Alternative Housing & Off-Grid Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (164);


-- Update Lifestyle > Other > Life Philosophy & Deep Thoughts
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Other',
  topic_micro = 'Life Philosophy & Deep Thoughts',
  updated_at = NOW()
WHERE topic_cluster_id IN (195);


-- Update Technology > Gaming Tech > Gaming Hardware & PC Building
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Gaming Tech',
  topic_micro = 'Gaming Hardware & PC Building',
  updated_at = NOW()
WHERE topic_cluster_id IN (28);


-- Update Music > Music Production > Professional Music Production
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Professional Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (29);


-- Update Music > Music Production > Professional Audio Engineering
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Professional Audio Engineering',
  updated_at = NOW()
WHERE topic_cluster_id IN (79);


-- Update Music > Music Production > Electronic Music Production
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Electronic Music Production',
  updated_at = NOW()
WHERE topic_cluster_id IN (83);


-- Update Music > Music Production > Music Recording & Studio Setup
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Production',
  topic_micro = 'Music Recording & Studio Setup',
  updated_at = NOW()
WHERE topic_cluster_id IN (89);


-- Update Business > Other > Motivational Speaking & Leadership
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Motivational Speaking & Leadership',
  updated_at = NOW()
WHERE topic_cluster_id IN (32);


-- Update Business > Other > Restaurant Business & Food Industry
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Restaurant Business & Food Industry',
  updated_at = NOW()
WHERE topic_cluster_id IN (101);


-- Update Business > Other > Real Estate Agent Training & Tips
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Real Estate Agent Training & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (128);


-- Update Business > Other > Public Speaking & Communication
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Public Speaking & Communication',
  updated_at = NOW()
WHERE topic_cluster_id IN (129);


-- Update Business > Other > Passive Income & Side Hustles
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Passive Income & Side Hustles',
  updated_at = NOW()
WHERE topic_cluster_id IN (145);


-- Update Business > Other > Content Strategy & Channel Growth
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Other',
  topic_micro = 'Content Strategy & Channel Growth',
  updated_at = NOW()
WHERE topic_cluster_id IN (212);


-- Update DIY & Crafts > Digital Fabrication > Laser Cutting & CNC Projects
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Digital Fabrication',
  topic_micro = 'Laser Cutting & CNC Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (35);


-- Update Travel > Destination Guides > Travel Planning & Destination Guides
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Destination Guides',
  topic_micro = 'Travel Planning & Destination Guides',
  updated_at = NOW()
WHERE topic_cluster_id IN (37);


-- Update Travel > Destination Guides > Travel Tips & Destination Reviews
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Destination Guides',
  topic_micro = 'Travel Tips & Destination Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (105);


-- Update Education > Educational Content > Educational Documentary Content
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Educational Documentary Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (38);


-- Update Education > Educational Content > Educational Explainer Videos
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Educational Explainer Videos',
  updated_at = NOW()
WHERE topic_cluster_id IN (74);


-- Update Education > Educational Content > Medical Education & Health Facts
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Medical Education & Health Facts',
  updated_at = NOW()
WHERE topic_cluster_id IN (147);


-- Update Education > Educational Content > Coding Bootcamps & Tech Education
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Coding Bootcamps & Tech Education',
  updated_at = NOW()
WHERE topic_cluster_id IN (171);


-- Update Education > Educational Content > Effective Study Methods & Learning
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Effective Study Methods & Learning',
  updated_at = NOW()
WHERE topic_cluster_id IN (186);


-- Update Education > Educational Content > Cultural Education & World Awareness
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Cultural Education & World Awareness',
  updated_at = NOW()
WHERE topic_cluster_id IN (200);


-- Update Education > Educational Content > Art Education & Teaching Methods
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Art Education & Teaching Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (203);


-- Update Education > Educational Content > Scientific Art & STEAM Projects
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Scientific Art & STEAM Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (213);


-- Update Education > Educational Content > Global Perspectives & World Views
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Educational Content',
  topic_micro = 'Global Perspectives & World Views',
  updated_at = NOW()
WHERE topic_cluster_id IN (215);


-- Update Home & Garden > Renovation > Home Renovation & Improvement
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Renovation',
  topic_micro = 'Home Renovation & Improvement',
  updated_at = NOW()
WHERE topic_cluster_id IN (39);


-- Update Business > E-commerce > Online Business & Passive Income
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'Online Business & Passive Income',
  updated_at = NOW()
WHERE topic_cluster_id IN (42);


-- Update Business > E-commerce > E-commerce & Amazon FBA
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'E-commerce & Amazon FBA',
  updated_at = NOW()
WHERE topic_cluster_id IN (68);


-- Update Business > E-commerce > Amazon Business & E-commerce Tips
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'Amazon Business & E-commerce Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (158);


-- Update Business > E-commerce > E-commerce Strategies & Online Sales
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'E-commerce',
  topic_micro = 'E-commerce Strategies & Online Sales',
  updated_at = NOW()
WHERE topic_cluster_id IN (193);


-- Update Technology > Tech Industry > Tech Industry News & Analysis
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Tech Industry',
  topic_micro = 'Tech Industry News & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (43);


-- Update Technology > Tech Industry > Tech News & Industry Updates
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Tech Industry',
  topic_micro = 'Tech News & Industry Updates',
  updated_at = NOW()
WHERE topic_cluster_id IN (122);


-- Update Lifestyle > Family Life > Family Vlogs & Parenting
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Family Life',
  topic_micro = 'Family Vlogs & Parenting',
  updated_at = NOW()
WHERE topic_cluster_id IN (44);


-- Update Lifestyle > Family Life > Mom Life & Family Organization
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Family Life',
  topic_micro = 'Mom Life & Family Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (136);


-- Update Outdoors > Camping > Outdoor Adventure & Camping
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Camping',
  topic_micro = 'Outdoor Adventure & Camping',
  updated_at = NOW()
WHERE topic_cluster_id IN (45);


-- Update Education > Other > Historical Analysis & Storytelling
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Other',
  topic_micro = 'Historical Analysis & Storytelling',
  updated_at = NOW()
WHERE topic_cluster_id IN (47);


-- Update Entertainment > True Crime > Mystery & True Crime Content
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'True Crime',
  topic_micro = 'Mystery & True Crime Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (48);


-- Update Home & Garden > Organization > Home Storage & Organization Solutions
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Organization',
  topic_micro = 'Home Storage & Organization Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (52);


-- Update Business > Creative Business > Professional Photography Business
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Creative Business',
  topic_micro = 'Professional Photography Business',
  updated_at = NOW()
WHERE topic_cluster_id IN (53);


-- Update Lifestyle > Fashion & Beauty > Daily Vlogs & Lifestyle Content
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Daily Vlogs & Lifestyle Content',
  updated_at = NOW()
WHERE topic_cluster_id IN (54);


-- Update Lifestyle > Fashion & Beauty > Simple Living & Lifestyle Design
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Simple Living & Lifestyle Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (126);


-- Update Lifestyle > Fashion & Beauty > Lifestyle Transformation & Habits
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Lifestyle Transformation & Habits',
  updated_at = NOW()
WHERE topic_cluster_id IN (181);


-- Update Lifestyle > Fashion & Beauty > Lifestyle Optimization & Efficiency
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Fashion & Beauty',
  topic_micro = 'Lifestyle Optimization & Efficiency',
  updated_at = NOW()
WHERE topic_cluster_id IN (205);


-- Update Music > Performance > Music Performance & Covers
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Performance',
  topic_micro = 'Music Performance & Covers',
  updated_at = NOW()
WHERE topic_cluster_id IN (55);


-- Update Music > Performance > Live Music & Concert Coverage
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Performance',
  topic_micro = 'Live Music & Concert Coverage',
  updated_at = NOW()
WHERE topic_cluster_id IN (211);


-- Update Lifestyle > Wellness > Personal Growth & Mindfulness
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Wellness',
  topic_micro = 'Personal Growth & Mindfulness',
  updated_at = NOW()
WHERE topic_cluster_id IN (56);


-- Update DIY & Crafts > Metalworking > Metalworking & Knife Making
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Metalworking & Knife Making',
  updated_at = NOW()
WHERE topic_cluster_id IN (57);


-- Update DIY & Crafts > Metalworking > Professional Knife Making & Bladesmithing
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Professional Knife Making & Bladesmithing',
  updated_at = NOW()
WHERE topic_cluster_id IN (167);


-- Update DIY & Crafts > Metalworking > Advanced Metalworking & Fabrication
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Metalworking',
  topic_micro = 'Advanced Metalworking & Fabrication',
  updated_at = NOW()
WHERE topic_cluster_id IN (170);


-- Update Sports > Extreme Sports > Adventure Sports & Extreme Activities
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Extreme Sports',
  topic_micro = 'Adventure Sports & Extreme Activities',
  updated_at = NOW()
WHERE topic_cluster_id IN (58);


-- Update Technology > Programming > Programming & Coding Tutorials
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Programming & Coding Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (59);


-- Update Technology > Programming > Python Programming & Data Science
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Python Programming & Data Science',
  updated_at = NOW()
WHERE topic_cluster_id IN (165);


-- Update Technology > Programming > Web Development & JavaScript
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Web Development & JavaScript',
  updated_at = NOW()
WHERE topic_cluster_id IN (175);


-- Update Technology > Programming > Full-Stack Development & Coding
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Programming',
  topic_micro = 'Full-Stack Development & Coding',
  updated_at = NOW()
WHERE topic_cluster_id IN (183);


-- Update Entertainment > Pop Culture > Entertainment News & Pop Culture
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Pop Culture',
  topic_micro = 'Entertainment News & Pop Culture',
  updated_at = NOW()
WHERE topic_cluster_id IN (60);


-- Update Food & Cooking > Food Reviews > Restaurant Reviews & Food Tours
UPDATE videos 
SET 
  topic_domain = 'Food & Cooking',
  topic_niche = 'Food Reviews',
  topic_micro = 'Restaurant Reviews & Food Tours',
  updated_at = NOW()
WHERE topic_cluster_id IN (61);


-- Update Lifestyle > Daily Vlogs > Morning Routines & Productivity
UPDATE videos 
SET 
  topic_domain = 'Lifestyle',
  topic_niche = 'Daily Vlogs',
  topic_micro = 'Morning Routines & Productivity',
  updated_at = NOW()
WHERE topic_cluster_id IN (62);


-- Update News & Politics > Current Events > World News & Current Events
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'Current Events',
  topic_micro = 'World News & Current Events',
  updated_at = NOW()
WHERE topic_cluster_id IN (65);


-- Update Outdoors > Gear Reviews > Camping Gear Reviews & Tips
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Gear Reviews',
  topic_micro = 'Camping Gear Reviews & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (66);


-- Update Arts & Media > Painting > Painting Techniques & Art Tutorials
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Painting',
  topic_micro = 'Painting Techniques & Art Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (69);


-- Update Home & Garden > Home Repair > Home Repairs & Maintenance
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Home Repair',
  topic_micro = 'Home Repairs & Maintenance',
  updated_at = NOW()
WHERE topic_cluster_id IN (70);


-- Update Finance > Real Estate > Real Estate Investment Strategies
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Real Estate',
  topic_micro = 'Real Estate Investment Strategies',
  updated_at = NOW()
WHERE topic_cluster_id IN (71);


-- Update Home & Garden > Bathrooms > Bathroom Renovations & Plumbing
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Bathrooms',
  topic_micro = 'Bathroom Renovations & Plumbing',
  updated_at = NOW()
WHERE topic_cluster_id IN (72);


-- Update Travel > Other > RV Life & Mobile Living
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Other',
  topic_micro = 'RV Life & Mobile Living',
  updated_at = NOW()
WHERE topic_cluster_id IN (73);


-- Update Entertainment > Star Wars > Star Wars Fan Content & Reviews
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Star Wars',
  topic_micro = 'Star Wars Fan Content & Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (75);


-- Update Outdoors > Survival > Outdoor Survival & Bushcraft
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Survival',
  topic_micro = 'Outdoor Survival & Bushcraft',
  updated_at = NOW()
WHERE topic_cluster_id IN (76);


-- Update Music > Music Gear > Music Gear Reviews & Demos
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Gear',
  topic_micro = 'Music Gear Reviews & Demos',
  updated_at = NOW()
WHERE topic_cluster_id IN (77);


-- Update Music > Music Gear > Professional Music Equipment
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Gear',
  topic_micro = 'Professional Music Equipment',
  updated_at = NOW()
WHERE topic_cluster_id IN (94);


-- Update Home & Garden > Kitchens > Kitchen Design & Renovation
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Kitchens',
  topic_micro = 'Kitchen Design & Renovation',
  updated_at = NOW()
WHERE topic_cluster_id IN (78);


-- Update Arts & Media > Art Education > Art Techniques & Creative Process
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Art Education',
  topic_micro = 'Art Techniques & Creative Process',
  updated_at = NOW()
WHERE topic_cluster_id IN (80);


-- Update Home & Garden > Small Spaces > Small Space Design Solutions
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Small Spaces',
  topic_micro = 'Small Space Design Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (81);


-- Update News & Politics > Political Analysis > Political Commentary & Analysis
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'Political Analysis',
  topic_micro = 'Political Commentary & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (86);


-- Update Outdoors > Winter Activities > Winter Camping & Cold Weather Gear
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Winter Activities',
  topic_micro = 'Winter Camping & Cold Weather Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (87);


-- Update Arts & Media > Photography Projects > Creative Photography Projects
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Photography Projects',
  topic_micro = 'Creative Photography Projects',
  updated_at = NOW()
WHERE topic_cluster_id IN (88);


-- Update News & Politics > World News > International News & Global Affairs
UPDATE videos 
SET 
  topic_domain = 'News & Politics',
  topic_niche = 'World News',
  topic_micro = 'International News & Global Affairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (92);


-- Update Entertainment > Comedy > Comedy Sketches & Entertainment
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Comedy',
  topic_micro = 'Comedy Sketches & Entertainment',
  updated_at = NOW()
WHERE topic_cluster_id IN (95);


-- Update Hobbies > LEGO Technic > LEGO Technic & Advanced Builds
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO Technic',
  topic_micro = 'LEGO Technic & Advanced Builds',
  updated_at = NOW()
WHERE topic_cluster_id IN (96);


-- Update Sports > Sports History > Sports History & Analysis
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Sports History',
  topic_micro = 'Sports History & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (98);


-- Update Finance > Trading > Stock Trading Strategies & Tips
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Trading',
  topic_micro = 'Stock Trading Strategies & Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (102);


-- Update Finance > Market Analysis > Real Estate Market Analysis
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Market Analysis',
  topic_micro = 'Real Estate Market Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (103);


-- Update DIY & Crafts > Home DIY > DIY Home Projects & Repairs
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Home DIY',
  topic_micro = 'DIY Home Projects & Repairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (104);


-- Update Finance > Personal Finance > Personal Finance & Money Management
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Personal Finance',
  topic_micro = 'Personal Finance & Money Management',
  updated_at = NOW()
WHERE topic_cluster_id IN (106);


-- Update Outdoors > Equipment > Outdoor Gear & Equipment Reviews
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Equipment',
  topic_micro = 'Outdoor Gear & Equipment Reviews',
  updated_at = NOW()
WHERE topic_cluster_id IN (107);


-- Update Hobbies > Card Games > Trading Card Games & Collectibles
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Card Games',
  topic_micro = 'Trading Card Games & Collectibles',
  updated_at = NOW()
WHERE topic_cluster_id IN (108);


-- Update Arts & Media > Drawing > Drawing Tutorials & Techniques
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Drawing',
  topic_micro = 'Drawing Tutorials & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (110);


-- Update Technology > Electronics > Robotics Projects & Engineering
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Robotics Projects & Engineering',
  updated_at = NOW()
WHERE topic_cluster_id IN (112);


-- Update Technology > Electronics > Electronics Projects & Arduino
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Electronics Projects & Arduino',
  updated_at = NOW()
WHERE topic_cluster_id IN (132);


-- Update Technology > Electronics > Electronics Assembly & Soldering
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Electronics Assembly & Soldering',
  updated_at = NOW()
WHERE topic_cluster_id IN (155);


-- Update Technology > Electronics > Advanced Electronics & Circuit Design
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Electronics',
  topic_micro = 'Advanced Electronics & Circuit Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (159);


-- Update Automotive > Car Repair > Auto Repair & Car Maintenance
UPDATE videos 
SET 
  topic_domain = 'Automotive',
  topic_niche = 'Car Repair',
  topic_micro = 'Auto Repair & Car Maintenance',
  updated_at = NOW()
WHERE topic_cluster_id IN (113);


-- Update Home & Garden > Wall Repair > Drywall & Ceiling Repairs
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Wall Repair',
  topic_micro = 'Drywall & Ceiling Repairs',
  updated_at = NOW()
WHERE topic_cluster_id IN (115);


-- Update DIY & Crafts > Crafts > Epoxy Resin Art & Tables
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Crafts',
  topic_micro = 'Epoxy Resin Art & Tables',
  updated_at = NOW()
WHERE topic_cluster_id IN (116);


-- Update DIY & Crafts > Crafts > Artisan Crafts & Handmade Goods
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Crafts',
  topic_micro = 'Artisan Crafts & Handmade Goods',
  updated_at = NOW()
WHERE topic_cluster_id IN (197);


-- Update DIY & Crafts > Sewing & Textiles > Sewing Projects & Fashion DIY
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Sewing & Textiles',
  topic_micro = 'Sewing Projects & Fashion DIY',
  updated_at = NOW()
WHERE topic_cluster_id IN (118);


-- Update Entertainment > Star Wars Lore > Star Wars Lore & Deep Dives
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Star Wars Lore',
  topic_micro = 'Star Wars Lore & Deep Dives',
  updated_at = NOW()
WHERE topic_cluster_id IN (119);


-- Update Education > Skills Training > Educational Series & Crash Courses
UPDATE videos 
SET 
  topic_domain = 'Education',
  topic_niche = 'Skills Training',
  topic_micro = 'Educational Series & Crash Courses',
  updated_at = NOW()
WHERE topic_cluster_id IN (120);


-- Update Business > Business Strategy > Business Strategy & Management
UPDATE videos 
SET 
  topic_domain = 'Business',
  topic_niche = 'Business Strategy',
  topic_micro = 'Business Strategy & Management',
  updated_at = NOW()
WHERE topic_cluster_id IN (123);


-- Update Finance > Housing Market > Housing Market Trends & Analysis
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Housing Market',
  topic_micro = 'Housing Market Trends & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (127);


-- Update Entertainment > Creator Content > YouTube Milestones & Celebrations
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Creator Content',
  topic_micro = 'YouTube Milestones & Celebrations',
  updated_at = NOW()
WHERE topic_cluster_id IN (130);


-- Update Health & Wellness > Eye Care > Eye Health & Vision Care
UPDATE videos 
SET 
  topic_domain = 'Health & Wellness',
  topic_niche = 'Eye Care',
  topic_micro = 'Eye Health & Vision Care',
  updated_at = NOW()
WHERE topic_cluster_id IN (131);


-- Update Hobbies > Pokemon Cards > Pokemon Card Collecting & Opening
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Pokemon Cards',
  topic_micro = 'Pokemon Card Collecting & Opening',
  updated_at = NOW()
WHERE topic_cluster_id IN (134);


-- Update Outdoors > Winter Sports > Winter Outdoor Adventures
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Winter Sports',
  topic_micro = 'Winter Outdoor Adventures',
  updated_at = NOW()
WHERE topic_cluster_id IN (137);


-- Update DIY & Crafts > Other > RV Renovations & Upgrades
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Other',
  topic_micro = 'RV Renovations & Upgrades',
  updated_at = NOW()
WHERE topic_cluster_id IN (138);


-- Update DIY & Crafts > Other > Tiny House Building & Design
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Other',
  topic_micro = 'Tiny House Building & Design',
  updated_at = NOW()
WHERE topic_cluster_id IN (204);


-- Update Arts & Media > Art History > Art History & Technique Analysis
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Art History',
  topic_micro = 'Art History & Technique Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (139);


-- Update Arts & Media > Painting Tutorials > Step-by-Step Painting Tutorials
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Painting Tutorials',
  topic_micro = 'Step-by-Step Painting Tutorials',
  updated_at = NOW()
WHERE topic_cluster_id IN (140);


-- Update Hobbies > LEGO Collecting > LEGO Star Wars Collections
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'LEGO Collecting',
  topic_micro = 'LEGO Star Wars Collections',
  updated_at = NOW()
WHERE topic_cluster_id IN (141);


-- Update Sports > Formula 1 > Formula 1 Racing & Analysis
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Formula 1',
  topic_micro = 'Formula 1 Racing & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (142);


-- Update Health & Fitness > Other > Bodybuilding & Muscle Growth
UPDATE videos 
SET 
  topic_domain = 'Health & Fitness',
  topic_niche = 'Other',
  topic_micro = 'Bodybuilding & Muscle Growth',
  updated_at = NOW()
WHERE topic_cluster_id IN (144);


-- Update Sports > Martial Arts > Martial Arts Training & Techniques
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'Martial Arts',
  topic_micro = 'Martial Arts Training & Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (146);


-- Update Entertainment > Slow Motion > Slow Motion Science & Experiments
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Slow Motion',
  topic_micro = 'Slow Motion Science & Experiments',
  updated_at = NOW()
WHERE topic_cluster_id IN (148);


-- Update Hobbies > Cosplay > Prop Making & 3D Printed Cosplay
UPDATE videos 
SET 
  topic_domain = 'Hobbies',
  topic_niche = 'Cosplay',
  topic_micro = 'Prop Making & 3D Printed Cosplay',
  updated_at = NOW()
WHERE topic_cluster_id IN (149);


-- Update Sports > College Football > College Football Coverage & Analysis
UPDATE videos 
SET 
  topic_domain = 'Sports',
  topic_niche = 'College Football',
  topic_micro = 'College Football Coverage & Analysis',
  updated_at = NOW()
WHERE topic_cluster_id IN (150);


-- Update Home & Garden > Bathroom Design > Bathroom Design & Renovation Ideas
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Bathroom Design',
  topic_micro = 'Bathroom Design & Renovation Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (151);


-- Update Music > Other > Music Reaction Videos & Commentary
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Other',
  topic_micro = 'Music Reaction Videos & Commentary',
  updated_at = NOW()
WHERE topic_cluster_id IN (152);


-- Update Music > Other > Professional Audio Production Tips
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Other',
  topic_micro = 'Professional Audio Production Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (194);


-- Update Technology > Mobile & Computing > iOS Tips & Apple Ecosystem
UPDATE videos 
SET 
  topic_domain = 'Technology',
  topic_niche = 'Mobile & Computing',
  topic_micro = 'iOS Tips & Apple Ecosystem',
  updated_at = NOW()
WHERE topic_cluster_id IN (154);


-- Update Home & Garden > Kitchen Storage > Kitchen Organization & Storage Hacks
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Kitchen Storage',
  topic_micro = 'Kitchen Organization & Storage Hacks',
  updated_at = NOW()
WHERE topic_cluster_id IN (156);


-- Update Entertainment > Live Interaction > Live Q&A Sessions & Community
UPDATE videos 
SET 
  topic_domain = 'Entertainment',
  topic_niche = 'Live Interaction',
  topic_micro = 'Live Q&A Sessions & Community',
  updated_at = NOW()
WHERE topic_cluster_id IN (157);


-- Update Arts & Media > Videography > Professional Videography & Filming
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Videography',
  topic_micro = 'Professional Videography & Filming',
  updated_at = NOW()
WHERE topic_cluster_id IN (161);


-- Update Home & Garden > Custom Storage > Custom Storage Solutions & Built-ins
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Custom Storage',
  topic_micro = 'Custom Storage Solutions & Built-ins',
  updated_at = NOW()
WHERE topic_cluster_id IN (166);


-- Update Arts & Media > Digital Art > Digital Art & Illustration Techniques
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Digital Art',
  topic_micro = 'Digital Art & Illustration Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (169);


-- Update Finance > Wealth Building > Investment Strategies & Wealth Building
UPDATE videos 
SET 
  topic_domain = 'Finance',
  topic_niche = 'Wealth Building',
  topic_micro = 'Investment Strategies & Wealth Building',
  updated_at = NOW()
WHERE topic_cluster_id IN (174);


-- Update DIY & Crafts > Workshop > Workshop Organization & Tool Storage
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Workshop Organization & Tool Storage',
  updated_at = NOW()
WHERE topic_cluster_id IN (176);


-- Update DIY & Crafts > Workshop > Professional Tool Reviews & Comparisons
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Professional Tool Reviews & Comparisons',
  updated_at = NOW()
WHERE topic_cluster_id IN (179);


-- Update DIY & Crafts > Workshop > Specialty Tool Making & Jigs
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Specialty Tool Making & Jigs',
  updated_at = NOW()
WHERE topic_cluster_id IN (191);


-- Update DIY & Crafts > Workshop > Custom Jigs & Workshop Solutions
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Custom Jigs & Workshop Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (196);


-- Update DIY & Crafts > Workshop > Home Workshop Setup & Organization
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Home Workshop Setup & Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (210);


-- Update DIY & Crafts > Workshop > Professional Workshop Equipment
UPDATE videos 
SET 
  topic_domain = 'DIY & Crafts',
  topic_niche = 'Workshop',
  topic_micro = 'Professional Workshop Equipment',
  updated_at = NOW()
WHERE topic_cluster_id IN (214);


-- Update Arts & Media > Documentary > Documentary Filmmaking & Storytelling
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Documentary',
  topic_micro = 'Documentary Filmmaking & Storytelling',
  updated_at = NOW()
WHERE topic_cluster_id IN (177);


-- Update Home & Garden > Space Saving > Space-Saving Furniture & Solutions
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Space Saving',
  topic_micro = 'Space-Saving Furniture & Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (180);


-- Update Home & Garden > Modular Storage > Modular Storage Systems & Organization
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Modular Storage',
  topic_micro = 'Modular Storage Systems & Organization',
  updated_at = NOW()
WHERE topic_cluster_id IN (182);


-- Update Music > Music Business > Professional Music Industry Insights
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Business',
  topic_micro = 'Professional Music Industry Insights',
  updated_at = NOW()
WHERE topic_cluster_id IN (184);


-- Update Music > Music Business > Music Business & Industry Tips
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Business',
  topic_micro = 'Music Business & Industry Tips',
  updated_at = NOW()
WHERE topic_cluster_id IN (188);


-- Update Arts & Media > Mixed Media > Mixed Media Art & Experimental Techniques
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Mixed Media',
  topic_micro = 'Mixed Media Art & Experimental Techniques',
  updated_at = NOW()
WHERE topic_cluster_id IN (187);


-- Update Home & Garden > Creative Storage > Creative Storage & Organization Ideas
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Creative Storage',
  topic_micro = 'Creative Storage & Organization Ideas',
  updated_at = NOW()
WHERE topic_cluster_id IN (189);


-- Update Arts & Media > Traditional Art > Traditional Art Techniques & Methods
UPDATE videos 
SET 
  topic_domain = 'Arts & Media',
  topic_niche = 'Traditional Art',
  topic_micro = 'Traditional Art Techniques & Methods',
  updated_at = NOW()
WHERE topic_cluster_id IN (190);


-- Update Travel > Cultural Travel > Global Travel & Cultural Experiences
UPDATE videos 
SET 
  topic_domain = 'Travel',
  topic_niche = 'Cultural Travel',
  topic_micro = 'Global Travel & Cultural Experiences',
  updated_at = NOW()
WHERE topic_cluster_id IN (192);


-- Update Home & Garden > Custom Shelving > Custom Shelving & Display Solutions
UPDATE videos 
SET 
  topic_domain = 'Home & Garden',
  topic_niche = 'Custom Shelving',
  topic_micro = 'Custom Shelving & Display Solutions',
  updated_at = NOW()
WHERE topic_cluster_id IN (206);


-- Update Outdoors > Extreme Camping > Extreme Weather Camping & Gear
UPDATE videos 
SET 
  topic_domain = 'Outdoors',
  topic_niche = 'Extreme Camping',
  topic_micro = 'Extreme Weather Camping & Gear',
  updated_at = NOW()
WHERE topic_cluster_id IN (207);


-- Update Music > Music Theory > Music Theory & Composition
UPDATE videos 
SET 
  topic_domain = 'Music',
  topic_niche = 'Music Theory',
  topic_micro = 'Music Theory & Composition',
  updated_at = NOW()
WHERE topic_cluster_id IN (209);


-- Verify the update
SELECT 
  COUNT(*) as updated_videos,
  COUNT(DISTINCT topic_cluster_id) as unique_clusters,
  COUNT(DISTINCT topic_domain) as unique_domains,
  COUNT(DISTINCT topic_niche) as unique_niches,
  COUNT(DISTINCT topic_micro) as unique_micros
FROM videos
WHERE topic_cluster_id IS NOT NULL
  AND topic_domain IS NOT NULL
  AND topic_niche IS NOT NULL
  AND topic_micro IS NOT NULL;

COMMIT;

-- Update topic hierarchy using CASE statements for efficiency
-- This updates all videos in a single pass

UPDATE videos
SET topic_niche = 
  CASE 
    -- DIY & Crafts
    WHEN topic_cluster_id IN (0,15,51,64,124,153,173,178,185) THEN 'Woodworking'
    WHEN topic_cluster_id IN (57,167,170) THEN 'Metalworking'
    WHEN topic_cluster_id IN (176,179,191,196,210,214) THEN 'Workshop'
    WHEN topic_cluster_id = 35 THEN 'Digital Fabrication'
    WHEN topic_cluster_id = 118 THEN 'Sewing & Textiles'
    WHEN topic_cluster_id = 104 THEN 'Home DIY'
    WHEN topic_cluster_id IN (116,197) THEN 'Crafts'
    WHEN topic_cluster_id IN (138,204) AND topic_domain = 'DIY & Crafts' THEN 'Other'
    
    -- Technology
    WHEN topic_cluster_id IN (59,165,175,183) THEN 'Programming'
    WHEN topic_cluster_id IN (12,41,114,143) THEN 'Photography & Video'
    WHEN topic_cluster_id IN (112,132,155,159) THEN 'Electronics'
    WHEN topic_cluster_id IN (22,97) THEN '3D Printing'
    WHEN topic_cluster_id IN (17,202) THEN 'AI & Innovation'
    WHEN topic_cluster_id = 10 THEN 'Audio Technology'
    WHEN topic_cluster_id = 28 THEN 'Gaming Tech'
    WHEN topic_cluster_id IN (5,33) THEN 'Electric Vehicles'
    WHEN topic_cluster_id = 154 THEN 'Mobile & Computing'
    WHEN topic_cluster_id IN (43,122) THEN 'Tech Industry'
    WHEN topic_cluster_id IN (8,90) AND topic_domain = 'Technology' THEN 'Other'
    
    -- Business
    WHEN topic_cluster_id IN (9,14,34,201) THEN 'Digital Marketing'
    WHEN topic_cluster_id IN (42,68,158,193) THEN 'E-commerce'
    WHEN topic_cluster_id IN (16,168) THEN 'Entrepreneurship'
    WHEN topic_cluster_id = 1 THEN 'Finance & Trading'
    WHEN topic_cluster_id = 123 THEN 'Business Strategy'
    WHEN topic_cluster_id = 53 THEN 'Creative Business'
    WHEN topic_cluster_id IN (32,101,128,129,145,212) AND topic_domain = 'Business' THEN 'Other'
    
    -- Music
    WHEN topic_cluster_id IN (29,79,83,89) THEN 'Music Production'
    WHEN topic_cluster_id IN (6,63,85,91,166) THEN 'Instruments'
    WHEN topic_cluster_id IN (77,94) THEN 'Music Gear'
    WHEN topic_cluster_id IN (55,211) THEN 'Performance'
    WHEN topic_cluster_id IN (184,188) THEN 'Music Business'
    WHEN topic_cluster_id = 209 THEN 'Music Theory'
    WHEN topic_cluster_id IN (152,194) AND topic_domain = 'Music' THEN 'Other'
    
    -- Gaming
    WHEN topic_cluster_id IN (18,20,93,99,109,111,135,163) THEN 'Gameplay'
    
    -- Lifestyle
    WHEN topic_cluster_id IN (2,36,117,160,169) THEN 'Home & Organization'
    WHEN topic_cluster_id IN (4,125,198) THEN 'Alternative Living'
    WHEN topic_cluster_id IN (54,126,181,205,207) THEN 'Fashion & Beauty'
    WHEN topic_cluster_id = 56 THEN 'Wellness'
    WHEN topic_cluster_id IN (44,136) THEN 'Family Life'
    WHEN topic_cluster_id = 62 THEN 'Daily Vlogs'
    WHEN topic_cluster_id IN (27,31,50,67,121,162,164,195) AND topic_domain = 'Lifestyle' THEN 'Other'
    
    -- Education
    WHEN topic_cluster_id IN (21,30,40,45,46,100,102,133,149) THEN 'Academic Subjects'
    WHEN topic_cluster_id IN (13,172,208) THEN 'Language Learning'
    WHEN topic_cluster_id = 120 THEN 'Skills Training'
    WHEN topic_cluster_id IN (38,74,147,148,157,171,174,186,189,200,203,213,215) THEN 'Educational Content'
    WHEN topic_cluster_id = 47 AND topic_domain = 'Education' THEN 'Other'
    
    -- Travel
    WHEN topic_cluster_id IN (26,49,199) THEN 'Adventure Travel'
    WHEN topic_cluster_id IN (37,105) THEN 'Destination Guides'
    WHEN topic_cluster_id = 7 THEN 'Theme Parks'
    WHEN topic_cluster_id = 192 THEN 'Cultural Travel'
    WHEN topic_cluster_id = 73 AND topic_domain = 'Travel' THEN 'Other'
    
    -- Food & Cooking
    WHEN topic_cluster_id IN (19,23,84) THEN 'Recipes'
    WHEN topic_cluster_id = 61 THEN 'Food Reviews'
    
    -- Health & Fitness
    WHEN topic_cluster_id IN (3,82) THEN 'Workouts'
    WHEN topic_cluster_id = 144 AND topic_domain = 'Health & Fitness' THEN 'Other'
    
    -- Finance
    WHEN topic_cluster_id = 11 THEN 'Investing'
    WHEN topic_cluster_id = 71 THEN 'Real Estate'
    WHEN topic_cluster_id = 102 THEN 'Trading'
    WHEN topic_cluster_id = 103 THEN 'Market Analysis'
    WHEN topic_cluster_id = 106 THEN 'Personal Finance'
    WHEN topic_cluster_id = 127 THEN 'Housing Market'
    WHEN topic_cluster_id = 174 THEN 'Wealth Building'
    
    -- Home & Garden
    WHEN topic_cluster_id = 39 THEN 'Renovation'
    WHEN topic_cluster_id = 52 THEN 'Organization'
    WHEN topic_cluster_id = 70 THEN 'Home Repair'
    WHEN topic_cluster_id = 72 THEN 'Bathrooms'
    WHEN topic_cluster_id = 78 THEN 'Kitchens'
    WHEN topic_cluster_id = 81 THEN 'Small Spaces'
    WHEN topic_cluster_id = 115 THEN 'Wall Repair'
    WHEN topic_cluster_id = 151 THEN 'Bathroom Design'
    WHEN topic_cluster_id = 156 THEN 'Kitchen Storage'
    WHEN topic_cluster_id = 166 THEN 'Custom Storage'
    WHEN topic_cluster_id = 180 THEN 'Space Saving'
    WHEN topic_cluster_id = 182 THEN 'Modular Storage'
    WHEN topic_cluster_id = 189 THEN 'Creative Storage'
    WHEN topic_cluster_id = 206 THEN 'Custom Shelving'
    
    -- Arts & Media
    WHEN topic_cluster_id = 25 THEN 'Photo Editing'
    WHEN topic_cluster_id = 69 THEN 'Painting'
    WHEN topic_cluster_id = 80 THEN 'Art Education'
    WHEN topic_cluster_id = 88 THEN 'Photography Projects'
    WHEN topic_cluster_id = 110 THEN 'Drawing'
    WHEN topic_cluster_id = 139 THEN 'Art History'
    WHEN topic_cluster_id = 140 THEN 'Painting Tutorials'
    WHEN topic_cluster_id = 161 THEN 'Videography'
    WHEN topic_cluster_id = 169 THEN 'Digital Art'
    WHEN topic_cluster_id = 177 THEN 'Documentary'
    WHEN topic_cluster_id = 187 THEN 'Mixed Media'
    WHEN topic_cluster_id = 190 THEN 'Traditional Art'
    
    -- Hobbies
    WHEN topic_cluster_id = 24 THEN 'LEGO'
    WHEN topic_cluster_id = 96 THEN 'LEGO Technic'
    WHEN topic_cluster_id = 108 THEN 'Card Games'
    WHEN topic_cluster_id = 134 THEN 'Pokemon Cards'
    WHEN topic_cluster_id = 141 THEN 'LEGO Collecting'
    WHEN topic_cluster_id = 149 THEN 'Cosplay'
    
    -- Entertainment
    WHEN topic_cluster_id = 48 THEN 'True Crime'
    WHEN topic_cluster_id = 60 THEN 'Pop Culture'
    WHEN topic_cluster_id = 75 THEN 'Star Wars'
    WHEN topic_cluster_id = 95 THEN 'Comedy'
    WHEN topic_cluster_id = 119 THEN 'Star Wars Lore'
    WHEN topic_cluster_id = 130 THEN 'Creator Content'
    WHEN topic_cluster_id = 148 THEN 'Slow Motion'
    WHEN topic_cluster_id = 157 THEN 'Live Interaction'
    
    -- Outdoors
    WHEN topic_cluster_id = 45 THEN 'Camping'
    WHEN topic_cluster_id = 66 THEN 'Gear Reviews'
    WHEN topic_cluster_id = 76 THEN 'Survival'
    WHEN topic_cluster_id = 87 THEN 'Winter Activities'
    WHEN topic_cluster_id = 107 THEN 'Equipment'
    WHEN topic_cluster_id = 137 THEN 'Winter Sports'
    WHEN topic_cluster_id = 207 THEN 'Extreme Camping'
    
    -- Sports
    WHEN topic_cluster_id = 58 THEN 'Extreme Sports'
    WHEN topic_cluster_id = 98 THEN 'Sports History'
    WHEN topic_cluster_id = 142 THEN 'Formula 1'
    WHEN topic_cluster_id = 146 THEN 'Martial Arts'
    WHEN topic_cluster_id = 150 THEN 'College Football'
    
    -- News & Politics
    WHEN topic_cluster_id = 65 THEN 'Current Events'
    WHEN topic_cluster_id = 86 THEN 'Political Analysis'
    WHEN topic_cluster_id = 92 THEN 'World News'
    
    -- Automotive
    WHEN topic_cluster_id = 113 THEN 'Car Repair'
    
    -- Health & Wellness
    WHEN topic_cluster_id = 131 THEN 'Eye Care'
    
    -- Keep existing niche if not in mapping
    ELSE topic_niche
  END
WHERE bertopic_version = 'v1_2025-08-01'
  AND topic_cluster_id >= -1;

-- Handle outliers separately for clarity
UPDATE videos 
SET topic_domain = 'Outlier', 
    topic_niche = 'Outlier', 
    topic_micro = 'Outlier'
WHERE topic_cluster_id = -1 
  AND bertopic_version = 'v1_2025-08-01';

-- Show results
SELECT topic_domain, topic_niche, COUNT(*) as video_count
FROM videos
WHERE bertopic_version = 'v1_2025-08-01'
GROUP BY topic_domain, topic_niche
ORDER BY topic_domain, topic_niche
LIMIT 50;
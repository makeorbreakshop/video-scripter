-- First, create a temporary mapping table
CREATE TEMP TABLE topic_hierarchy_mapping (
  cluster_id INTEGER PRIMARY KEY,
  new_domain TEXT,
  new_niche TEXT,
  new_micro TEXT
);

-- Insert the new hierarchy mappings
INSERT INTO topic_hierarchy_mapping VALUES
-- DIY & Crafts > Woodworking
(0, 'DIY & Crafts', 'Woodworking', 'Woodworking Projects & Tool Reviews'),
(15, 'DIY & Crafts', 'Woodworking', 'Creative Woodworking Ideas'),
(51, 'DIY & Crafts', 'Woodworking', 'Furniture Making & Wood Design'),
(64, 'DIY & Crafts', 'Woodworking', 'Cabinet Making & Fine Woodworking'),
(124, 'DIY & Crafts', 'Woodworking', 'Epoxy River Tables & Furniture'),
(153, 'DIY & Crafts', 'Woodworking', 'Handmade Cutting Boards & Crafts'),
(173, 'DIY & Crafts', 'Woodworking', 'Precision Woodworking & Joinery'),
(178, 'DIY & Crafts', 'Woodworking', 'Unique Furniture Designs & Builds'),
(185, 'DIY & Crafts', 'Woodworking', 'Advanced Woodworking Techniques'),

-- DIY & Crafts > Metalworking
(57, 'DIY & Crafts', 'Metalworking', 'Metalworking & Knife Making'),
(167, 'DIY & Crafts', 'Metalworking', 'Professional Knife Making & Bladesmithing'),
(170, 'DIY & Crafts', 'Metalworking', 'Advanced Metalworking & Fabrication'),

-- DIY & Crafts > Workshop
(176, 'DIY & Crafts', 'Workshop', 'Workshop Organization & Tool Storage'),
(179, 'DIY & Crafts', 'Workshop', 'Professional Tool Reviews & Comparisons'),
(191, 'DIY & Crafts', 'Workshop', 'Specialty Tool Making & Jigs'),
(196, 'DIY & Crafts', 'Workshop', 'Custom Jigs & Workshop Solutions'),
(210, 'DIY & Crafts', 'Workshop', 'Home Workshop Setup & Organization'),
(214, 'DIY & Crafts', 'Workshop', 'Professional Workshop Equipment'),

-- Technology > Programming
(59, 'Technology', 'Programming', 'Programming & Coding Tutorials'),
(165, 'Technology', 'Programming', 'Python Programming & Data Science'),
(175, 'Technology', 'Programming', 'Web Development & JavaScript'),
(183, 'Technology', 'Programming', 'Full-Stack Development & Coding'),

-- Technology > Photography & Video
(12, 'Technology', 'Photography & Video', 'Camera Gear & Photography Reviews'),
(41, 'Technology', 'Photography & Video', 'Drone Flying & Aerial Photography'),
(114, 'Technology', 'Photography & Video', 'Photography Accessories & Gear'),
(143, 'Technology', 'Photography & Video', 'Action Camera Reviews & Tests'),

-- Business > Digital Marketing
(9, 'Business', 'Digital Marketing', 'Instagram Marketing & E-commerce'),
(14, 'Business', 'Digital Marketing', 'YouTube Channel Growth Strategies'),
(34, 'Business', 'Digital Marketing', 'Content Creation Tools & Tips'),
(212, 'Business', 'Digital Marketing', 'Content Strategy & Channel Growth'),

-- Music > Music Production
(29, 'Music', 'Music Production', 'Professional Music Production'),
(79, 'Music', 'Music Production', 'Professional Audio Engineering'),
(83, 'Music', 'Music Production', 'Electronic Music Production'),
(89, 'Music', 'Music Production', 'Music Recording & Studio Setup');

-- I'll generate the rest programmatically...

-- Now update all videos in a single query
UPDATE videos v
SET 
  topic_domain = COALESCE(m.new_domain, v.topic_domain),
  topic_niche = COALESCE(m.new_niche, v.topic_niche),
  topic_micro = COALESCE(m.new_micro, v.topic_micro)
FROM topic_hierarchy_mapping m
WHERE v.topic_cluster_id = m.cluster_id
  AND v.bertopic_version = 'v1_2025-08-01';

-- Handle outliers separately
UPDATE videos
SET 
  topic_domain = 'Outlier',
  topic_niche = 'Outlier',
  topic_micro = 'Outlier'
WHERE topic_cluster_id = -1
  AND bertopic_version = 'v1_2025-08-01';

-- Drop the temp table
DROP TABLE topic_hierarchy_mapping;
#!/usr/bin/env python3
"""
Generate better, more intuitive topic names based on BERTopic keywords
Version 2: More descriptive and specific names
"""

import json
from datetime import datetime

def create_better_topic_names():
    """Create more intuitive and descriptive topic names"""
    
    # Based on the keywords from BERTopic, create better names
    # Format: (Primary Name, Category, Subcategory)
    topic_names = {
        # Maker/DIY/Crafts Cluster
        0: ("Woodworking Projects & Tool Reviews", "DIY & Crafts", "Woodworking"),
        1: ("AI Business & Stock Trading", "Business", "Tech Business"),
        2: ("Home Cleaning & Organization Routines", "Lifestyle", "Home Management"),
        3: ("Running & Fitness Training", "Health & Fitness", "Athletic Training"),
        4: ("Tiny Living & Alternative Housing", "Lifestyle", "Alternative Living"),
        5: ("Tesla & Electric Vehicle Reviews", "Technology", "Electric Vehicles"),
        6: ("Guitar Tutorials & Music Gear", "Music", "Instruments & Gear"),
        7: ("Disney Parks & Travel Vlogs", "Travel", "Theme Parks"),
        8: ("Live Streaming & 3D Content", "Technology", "Streaming"),
        9: ("Instagram Marketing & E-commerce", "Business", "Social Commerce"),
        10: ("Audio Equipment & Music Production", "Technology", "Audio Gear"),
        11: ("Stock Market & Real Estate Investing", "Finance", "Investing"),
        12: ("Camera Gear & Photography Reviews", "Technology", "Photography"),
        13: ("Spanish Language Learning", "Education", "Language Learning"),
        14: ("YouTube Channel Growth Strategies", "Business", "Content Creation"),
        15: ("Creative Woodworking Ideas", "DIY & Crafts", "Wood Design"),
        16: ("Business Scaling & Entrepreneurship", "Business", "Entrepreneurship"),
        17: ("AI Tools & Technology News", "Technology", "AI & Innovation"),
        18: ("Live Stream Gaming & Tech", "Gaming", "Streaming"),
        19: ("Food & Cooking Tutorials", "Food & Cooking", "Recipe Videos"),
        20: ("Minecraft Gameplay & Tutorials", "Gaming", "Minecraft"),
        21: ("Art History & Cultural Education", "Education", "Arts & Culture"),
        22: ("3D Printing Projects & Tutorials", "Technology", "3D Printing"),
        23: ("Meal Prep & Healthy Eating", "Food & Cooking", "Healthy Living"),
        24: ("LEGO Building & Set Reviews", "Hobbies", "LEGO"),
        25: ("Photography Editing & Techniques", "Arts & Media", "Photo Editing"),
        26: ("Adventure Travel & Exploration", "Travel", "Adventure"),
        27: ("Personal Development & Life Coaching", "Lifestyle", "Self-Improvement"),
        28: ("Gaming Hardware & PC Building", "Technology", "PC Gaming"),
        29: ("Professional Music Production", "Music", "Production"),
        30: ("Study Tips & Academic Success", "Education", "Study Skills"),
        31: ("Christian Faith & Bible Study", "Lifestyle", "Faith & Religion"),
        32: ("Motivational Speaking & Leadership", "Business", "Leadership"),
        33: ("Tech Product Unboxings", "Technology", "Product Reviews"),
        34: ("Content Creation Tools & Tips", "Business", "Creator Tools"),
        35: ("Laser Cutting & CNC Projects", "DIY & Crafts", "Digital Fabrication"),
        36: ("Minimalist Lifestyle & Decluttering", "Lifestyle", "Minimalism"),
        37: ("Travel Planning & Destination Guides", "Travel", "Travel Planning"),
        38: ("Educational Documentary Content", "Education", "Documentaries"),
        39: ("Home Renovation & Improvement", "Home & Garden", "Renovation"),
        40: ("Science Experiments & STEM Education", "Education", "Science"),
        41: ("Drone Flying & Aerial Photography", "Technology", "Drones"),
        42: ("Online Business & Passive Income", "Business", "Online Business"),
        43: ("Tech Industry News & Analysis", "Technology", "Tech News"),
        44: ("Family Vlogs & Parenting", "Lifestyle", "Family Life"),
        45: ("Outdoor Adventure & Camping", "Outdoors", "Camping"),
        46: ("History Documentaries & Education", "Education", "History"),
        47: ("Historical Analysis & Storytelling", "Education", "Historical Content"),
        48: ("Mystery & True Crime Content", "Entertainment", "True Crime"),
        49: ("Travel Adventures & Culture", "Travel", "Cultural Travel"),
        50: ("Budget Living & Frugal Tips", "Lifestyle", "Budgeting"),
        51: ("Furniture Making & Wood Design", "DIY & Crafts", "Furniture"),
        52: ("Home Storage & Organization Solutions", "Home & Garden", "Organization"),
        53: ("Professional Photography Business", "Business", "Photography Business"),
        54: ("Daily Vlogs & Lifestyle Content", "Lifestyle", "Vlogging"),
        55: ("Music Performance & Covers", "Music", "Performance"),
        56: ("Personal Growth & Mindfulness", "Lifestyle", "Wellness"),
        57: ("Metalworking & Knife Making", "DIY & Crafts", "Metalwork"),
        58: ("Adventure Sports & Extreme Activities", "Sports", "Extreme Sports"),
        59: ("Programming & Coding Tutorials", "Technology", "Programming"),
        60: ("Entertainment News & Pop Culture", "Entertainment", "Pop Culture"),
        61: ("Restaurant Reviews & Food Tours", "Food & Cooking", "Food Reviews"),
        62: ("Morning Routines & Productivity", "Lifestyle", "Productivity"),
        63: ("Music Theory & Instrument Lessons", "Music", "Music Education"),
        64: ("Cabinet Making & Fine Woodworking", "DIY & Crafts", "Cabinetry"),
        65: ("World News & Current Events", "News & Politics", "Current Events"),
        66: ("Camping Gear Reviews & Tips", "Outdoors", "Gear Reviews"),
        67: ("Inspirational Content & Life Stories", "Lifestyle", "Inspiration"),
        68: ("E-commerce & Amazon FBA", "Business", "E-commerce"),
        69: ("Painting Techniques & Art Tutorials", "Arts & Media", "Painting"),
        70: ("Home Repairs & Maintenance", "Home & Garden", "Home Repair"),
        71: ("Real Estate Investment Strategies", "Finance", "Real Estate"),
        72: ("Bathroom Renovations & Plumbing", "Home & Garden", "Bathrooms"),
        73: ("RV Life & Mobile Living", "Travel", "RV Living"),
        74: ("Educational Explainer Videos", "Education", "Explainers"),
        75: ("Star Wars Fan Content & Reviews", "Entertainment", "Star Wars"),
        76: ("Outdoor Survival & Bushcraft", "Outdoors", "Survival"),
        77: ("Music Gear Reviews & Demos", "Music", "Gear Reviews"),
        78: ("Kitchen Design & Renovation", "Home & Garden", "Kitchens"),
        79: ("Professional Audio Engineering", "Music", "Audio Engineering"),
        80: ("Art Techniques & Creative Process", "Arts & Media", "Art Education"),
        81: ("Small Space Design Solutions", "Home & Garden", "Small Spaces"),
        82: ("Fitness Challenges & Workouts", "Health & Fitness", "Workout Videos"),
        83: ("Electronic Music Production", "Music", "Electronic Music"),
        84: ("Nutrition & Healthy Recipes", "Food & Cooking", "Nutrition"),
        85: ("Guitar Gear & Equipment Reviews", "Music", "Guitar Gear"),
        86: ("Political Commentary & Analysis", "News & Politics", "Political Analysis"),
        87: ("Winter Camping & Cold Weather Gear", "Outdoors", "Winter Activities"),
        88: ("Creative Photography Projects", "Arts & Media", "Photography Projects"),
        89: ("Music Recording & Studio Setup", "Music", "Recording"),
        90: ("Technology Tutorials & How-To", "Technology", "Tech Tutorials"),
        91: ("Musical Instrument Reviews", "Music", "Instrument Reviews"),
        92: ("International News & Global Affairs", "News & Politics", "World News"),
        93: ("Gaming News & Industry Updates", "Gaming", "Gaming News"),
        94: ("Professional Music Equipment", "Music", "Pro Audio"),
        95: ("Comedy Sketches & Entertainment", "Entertainment", "Comedy"),
        96: ("LEGO Technic & Advanced Builds", "Hobbies", "LEGO Technic"),
        97: ("3D Printing Technology & Reviews", "Technology", "3D Print Tech"),
        98: ("Sports History & Analysis", "Sports", "Sports History"),
        99: ("Gaming Commentary & Let's Plays", "Gaming", "Gaming Content"),
        100: ("Scientific Demonstrations & Education", "Education", "Science Demos"),
        101: ("Restaurant Business & Food Industry", "Business", "Food Business"),
        102: ("Stock Trading Strategies & Tips", "Finance", "Trading"),
        103: ("Real Estate Market Analysis", "Finance", "Market Analysis"),
        104: ("DIY Home Projects & Repairs", "DIY & Crafts", "Home DIY"),
        105: ("Travel Tips & Destination Reviews", "Travel", "Travel Tips"),
        106: ("Personal Finance & Money Management", "Finance", "Personal Finance"),
        107: ("Outdoor Gear & Equipment Reviews", "Outdoors", "Equipment"),
        108: ("Trading Card Games & Collectibles", "Hobbies", "Card Games"),
        109: ("Gaming Challenges & Competitions", "Gaming", "Gaming Challenges"),
        110: ("Drawing Tutorials & Techniques", "Arts & Media", "Drawing"),
        111: ("Esports & Competitive Gaming", "Gaming", "Esports"),
        112: ("Robotics Projects & Engineering", "Technology", "Robotics"),
        113: ("Auto Repair & Car Maintenance", "Automotive", "Car Repair"),
        114: ("Photography Accessories & Gear", "Technology", "Photo Accessories"),
        115: ("Drywall & Ceiling Repairs", "Home & Garden", "Wall Repair"),
        116: ("Epoxy Resin Art & Tables", "DIY & Crafts", "Resin Art"),
        117: ("Extreme Decluttering & Minimalism", "Lifestyle", "Decluttering"),
        118: ("Sewing Projects & Fashion DIY", "DIY & Crafts", "Sewing"),
        119: ("Star Wars Lore & Deep Dives", "Entertainment", "Star Wars Lore"),
        120: ("Educational Series & Crash Courses", "Education", "Educational Series"),
        121: ("Micro Living & Tiny Apartments", "Lifestyle", "Micro Living"),
        122: ("Tech News & Industry Updates", "Technology", "Tech Industry"),
        123: ("Business Strategy & Management", "Business", "Business Strategy"),
        124: ("Epoxy River Tables & Furniture", "DIY & Crafts", "Epoxy Furniture"),
        125: ("Van Life & Nomadic Living", "Lifestyle", "Van Life"),
        126: ("Simple Living & Lifestyle Design", "Lifestyle", "Simple Living"),
        127: ("Housing Market Trends & Analysis", "Finance", "Housing Market"),
        128: ("Real Estate Agent Training & Tips", "Business", "Real Estate Training"),
        129: ("Public Speaking & Communication", "Business", "Communication"),
        130: ("YouTube Milestones & Celebrations", "Entertainment", "Creator Content"),
        131: ("Eye Health & Vision Care", "Health & Wellness", "Eye Care"),
        132: ("Electronics Projects & Arduino", "Technology", "Electronics"),
        133: ("Chemistry & Science Experiments", "Education", "Chemistry"),
        134: ("Pokemon Card Collecting & Opening", "Hobbies", "Pokemon Cards"),
        135: ("Fortnite Gameplay & Strategies", "Gaming", "Fortnite"),
        136: ("Mom Life & Family Organization", "Lifestyle", "Parenting"),
        137: ("Winter Outdoor Adventures", "Outdoors", "Winter Sports"),
        138: ("RV Renovations & Upgrades", "DIY & Crafts", "RV Mods"),
        139: ("Art History & Technique Analysis", "Arts & Media", "Art History"),
        140: ("Step-by-Step Painting Tutorials", "Arts & Media", "Painting Tutorials"),
        141: ("LEGO Star Wars Collections", "Hobbies", "LEGO Collecting"),
        142: ("Formula 1 Racing & Analysis", "Sports", "Formula 1"),
        143: ("Action Camera Reviews & Tests", "Technology", "Action Cameras"),
        144: ("Bodybuilding & Muscle Growth", "Health & Fitness", "Bodybuilding"),
        145: ("Passive Income & Side Hustles", "Business", "Income Streams"),
        146: ("Martial Arts Training & Techniques", "Sports", "Martial Arts"),
        147: ("Medical Education & Health Facts", "Education", "Medical Education"),
        148: ("Slow Motion Science & Experiments", "Entertainment", "Slow Motion"),
        149: ("Prop Making & 3D Printed Cosplay", "Hobbies", "Cosplay"),
        150: ("College Football Coverage & Analysis", "Sports", "College Football"),
        151: ("Bathroom Design & Renovation Ideas", "Home & Garden", "Bathroom Design"),
        152: ("Music Reaction Videos & Commentary", "Music", "Music Reactions"),
        153: ("Handmade Cutting Boards & Crafts", "DIY & Crafts", "Wood Crafts"),
        154: ("iOS Tips & Apple Ecosystem", "Technology", "Apple/iOS"),
        155: ("Electronics Assembly & Soldering", "Technology", "Electronics Assembly"),
        156: ("Kitchen Organization & Storage Hacks", "Home & Garden", "Kitchen Storage"),
        157: ("Live Q&A Sessions & Community", "Entertainment", "Live Interaction"),
        158: ("Amazon Business & E-commerce Tips", "Business", "Amazon Business"),
        159: ("Advanced Electronics & Circuit Design", "Technology", "Circuit Design"),
        160: ("Deep Cleaning & Organization Methods", "Lifestyle", "Deep Cleaning"),
        161: ("Professional Videography & Filming", "Arts & Media", "Videography"),
        162: ("Spiritual Growth & Faith Journey", "Lifestyle", "Spirituality"),
        163: ("Gaming Tutorials & Walkthroughs", "Gaming", "Game Guides"),
        164: ("Alternative Housing & Off-Grid Living", "Lifestyle", "Off-Grid Living"),
        165: ("Python Programming & Data Science", "Technology", "Python/Data Science"),
        166: ("Custom Storage Solutions & Built-ins", "Home & Garden", "Custom Storage"),
        167: ("Professional Knife Making & Bladesmithing", "DIY & Crafts", "Bladesmithing"),
        168: ("Business Growth & Scaling Strategies", "Business", "Business Growth"),
        169: ("Digital Art & Illustration Techniques", "Arts & Media", "Digital Art"),
        170: ("Advanced Metalworking & Fabrication", "DIY & Crafts", "Metal Fabrication"),
        171: ("Coding Bootcamps & Tech Education", "Education", "Tech Education"),
        172: ("Language Learning Tips & Resources", "Education", "Language Resources"),
        173: ("Precision Woodworking & Joinery", "DIY & Crafts", "Fine Woodworking"),
        174: ("Investment Strategies & Wealth Building", "Finance", "Wealth Building"),
        175: ("Web Development & JavaScript", "Technology", "Web Development"),
        176: ("Workshop Organization & Tool Storage", "DIY & Crafts", "Workshop Setup"),
        177: ("Documentary Filmmaking & Storytelling", "Arts & Media", "Documentary"),
        178: ("Unique Furniture Designs & Builds", "DIY & Crafts", "Designer Furniture"),
        179: ("Professional Tool Reviews & Comparisons", "DIY & Crafts", "Tool Reviews"),
        180: ("Space-Saving Furniture & Solutions", "Home & Garden", "Space Saving"),
        181: ("Lifestyle Transformation & Habits", "Lifestyle", "Life Changes"),
        182: ("Modular Storage Systems & Organization", "Home & Garden", "Modular Storage"),
        183: ("Full-Stack Development & Coding", "Technology", "Full-Stack Dev"),
        184: ("Professional Music Industry Insights", "Music", "Music Industry"),
        185: ("Advanced Woodworking Techniques", "DIY & Crafts", "Advanced Woodwork"),
        186: ("Effective Study Methods & Learning", "Education", "Learning Methods"),
        187: ("Mixed Media Art & Experimental Techniques", "Arts & Media", "Mixed Media"),
        188: ("Music Business & Industry Tips", "Music", "Music Business"),
        189: ("Creative Storage & Organization Ideas", "Home & Garden", "Creative Storage"),
        190: ("Traditional Art Techniques & Methods", "Arts & Media", "Traditional Art"),
        191: ("Specialty Tool Making & Jigs", "DIY & Crafts", "Tool Making"),
        192: ("Global Travel & Cultural Experiences", "Travel", "World Travel"),
        193: ("E-commerce Strategies & Online Sales", "Business", "E-commerce Strategy"),
        194: ("Professional Audio Production Tips", "Music", "Audio Production"),
        195: ("Life Philosophy & Deep Thoughts", "Lifestyle", "Philosophy"),
        196: ("Custom Jigs & Workshop Solutions", "DIY & Crafts", "Workshop Jigs"),
        197: ("Artisan Crafts & Handmade Goods", "DIY & Crafts", "Artisan Crafts"),
        198: ("Mobile Home & Tiny House Tours", "Lifestyle", "Mobile Homes"),
        199: ("Adventure Planning & Travel Prep", "Travel", "Adventure Planning"),
        200: ("Cultural Education & World Awareness", "Education", "Cultural Education"),
        201: ("Photography Business & Marketing", "Business", "Photo Business"),
        202: ("Future Tech & Innovation Trends", "Technology", "Future Tech"),
        203: ("Art Education & Teaching Methods", "Education", "Art Teaching"),
        204: ("Tiny House Building & Design", "DIY & Crafts", "Tiny House Build"),
        205: ("Lifestyle Optimization & Efficiency", "Lifestyle", "Life Optimization"),
        206: ("Custom Shelving & Display Solutions", "Home & Garden", "Custom Shelving"),
        207: ("Extreme Weather Camping & Gear", "Outdoors", "Extreme Camping"),
        208: ("Polyglot Tips & Multiple Languages", "Education", "Polyglot Learning"),
        209: ("Music Theory & Composition", "Music", "Music Theory"),
        210: ("Home Workshop Setup & Organization", "DIY & Crafts", "Workshop Design"),
        211: ("Live Music & Concert Coverage", "Music", "Live Music"),
        212: ("Content Strategy & Channel Growth", "Business", "Content Strategy"),
        213: ("Scientific Art & STEAM Projects", "Education", "STEAM Education"),
        214: ("Professional Workshop Equipment", "DIY & Crafts", "Pro Equipment"),
        215: ("Global Perspectives & World Views", "Education", "Global Education")
    }
    
    return topic_names

def save_better_names():
    """Save the improved topic names"""
    topic_names = create_better_topic_names()
    
    # Create structured output
    output = {
        "metadata": {
            "version": "2.0",
            "created": datetime.now().isoformat(),
            "total_topics": len(topic_names),
            "description": "Improved human-readable topic names based on BERTopic keywords"
        },
        "topics": {}
    }
    
    # Add each topic with its details
    for topic_id, (name, category, subcategory) in topic_names.items():
        output["topics"][topic_id] = {
            "name": name,
            "category": category,
            "subcategory": subcategory
        }
    
    # Save to JSON
    with open('better_topic_names_v2.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    # Also create a simple CSV for easy viewing
    with open('better_topic_names_v2.csv', 'w') as f:
        f.write("topic_id,name,category,subcategory\n")
        for topic_id, (name, category, subcategory) in sorted(topic_names.items()):
            f.write(f'{topic_id},"{name}","{category}","{subcategory}"\n')
    
    print(f"✅ Saved {len(topic_names)} improved topic names to:")
    print("   - better_topic_names_v2.json")
    print("   - better_topic_names_v2.csv")
    
    # Show some examples
    print("\nExample improved names:")
    for i in range(0, 20, 5):
        name, cat, subcat = topic_names[i]
        print(f"   Topic {i}: {name} ({cat} > {subcat})")

if __name__ == "__main__":
    save_better_names()
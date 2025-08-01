# BERTopic Dendrogram-Based Hierarchy

## Overview

This hierarchy was generated using BERTopic's built-in `hierarchical_topics()` method, which creates a dendrogram showing how topics merge based on cosine similarity of their embeddings. The hierarchy has 215 merges, reducing from 216 original topics down to a single root.

## Hierarchy Statistics

- **Total Topics**: 216 (excluding outliers)
- **Total Merges**: 215
- **Sample Size**: 29,480 documents
- **Hierarchy Levels**:
  - Fine: 216 topics
  - Medium: 49 topics  
  - Coarse: 19 topics

## How the Hierarchy Works

The dendrogram shows topics merging based on their semantic similarity. Lower distance values indicate more similar topics that merge earlier, while higher distances indicate more distinct topic groups that only merge at higher levels.

## Top-Level Structure (Distance > 1.8)

### Root Merge (Distance: 1.855)
The entire topic space ultimately divides into two major branches:

1. **Review/DIY/Tech Branch** (428) - Contains most topics related to reviews, making, tech, gaming
2. **Woodworking/Home Design Branch** (429) - Contains home improvement, tiny houses, and related content

## Major Clusters (Distance 1.5-1.8)

### 1. Tech & DIY Cluster (Distance: 1.668)
- **Laser Cutting & Tool Reviews** 
- **3D Printing & LEGO**
- **Guitar & Music Tech**
- **Professional Equipment Reviews**

### 2. Lifestyle & Content Creation (Distance: 1.543)
- **Daily Routines & Cleaning**
- **YouTube & AI Content**
- **Card Reviews & Finance**
- **World Travel & Disney**

### 3. Home & Design (Distance: 1.676)
- **Woodworking Projects**
- **Tiny Houses & Van Life**
- **Kitchen Organization**
- **Storage Solutions**

## Mid-Level Groupings (Distance 1.2-1.5)

### Making & Crafts Group
- **Laser/Saw/Knife Making** (Distance: 1.324)
  - Laser cutting projects
  - Woodworking with saws
  - Knife making tutorials
  - Jig construction

### Content & Media Group  
- **AI/YouTube/Photography** (Distance: 1.333)
  - AI tools and news
  - YouTube growth strategies
  - Photography tutorials
  - Disney content

### Lifestyle Organization Group
- **Routines/Cleaning/Motivation** (Distance: 1.305)
  - Morning routines
  - Extreme cleaning
  - Motivation content
  - Home organization

## Low-Level Merges (Distance < 1.2)

These represent the most similar topics that merge first:

### Electronics & Gaming
- **Audio Equipment** + **Music Production** → Music Tech (Distance: 1.112)
- **Gaming Peripherals** + **PC Building** → Gaming Hardware (Distance: 1.115)

### Home Improvement
- **Kitchen Cabinets** + **IKEA Organization** → Kitchen Storage (Distance: 1.115)
- **Bathroom Renovation** + **Installation Guides** → Home Renovation (Distance: 1.138)

### Educational Content
- **Spanish Learning** + **Language Study** → Language Learning (Distance: 1.137)
- **Coding Tutorials** + **Python/React** → Programming Education (Distance: 1.134)

## Improved Topic Names

I've created more descriptive and intuitive names for all 216 topics. Here are some key examples organized by category:

### DIY & Crafts
- Topic 0: **Woodworking Projects & Tool Reviews**
- Topic 35: **Laser Cutting & CNC Projects**
- Topic 57: **Metalworking & Knife Making**
- Topic 116: **Epoxy Resin Art & Tables**
- Topic 124: **Epoxy River Tables & Furniture**
- Topic 153: **Handmade Cutting Boards & Crafts**
- Topic 167: **Professional Knife Making & Bladesmithing**
- Topic 173: **Precision Woodworking & Joinery**

### Technology & Innovation
- Topic 5: **Tesla & Electric Vehicle Reviews**
- Topic 17: **AI Tools & Technology News**
- Topic 22: **3D Printing Projects & Tutorials**
- Topic 41: **Drone Flying & Aerial Photography**
- Topic 97: **3D Printing Technology & Reviews**
- Topic 112: **Robotics Projects & Engineering**
- Topic 132: **Electronics Projects & Arduino**
- Topic 165: **Python Programming & Data Science**

### Music & Audio
- Topic 6: **Guitar Tutorials & Music Gear**
- Topic 10: **Audio Equipment & Music Production**
- Topic 29: **Professional Music Production**
- Topic 55: **Music Performance & Covers**
- Topic 77: **Music Gear Reviews & Demos**
- Topic 152: **Music Reaction Videos & Commentary**
- Topic 184: **Professional Music Industry Insights**
- Topic 209: **Music Theory & Composition**

### Lifestyle & Living
- Topic 2: **Home Cleaning & Organization Routines**
- Topic 4: **Tiny Living & Alternative Housing**
- Topic 73: **RV Life & Mobile Living**
- Topic 125: **Van Life & Nomadic Living**
- Topic 117: **Extreme Decluttering & Minimalism**
- Topic 126: **Simple Living & Lifestyle Design**
- Topic 164: **Alternative Housing & Off-Grid Living**
- Topic 198: **Mobile Home & Tiny House Tours**

### Business & Finance
- Topic 1: **AI Business & Stock Trading**
- Topic 11: **Stock Market & Real Estate Investing**
- Topic 42: **Online Business & Passive Income**
- Topic 68: **E-commerce & Amazon FBA**
- Topic 102: **Stock Trading Strategies & Tips**
- Topic 127: **Housing Market Trends & Analysis**
- Topic 145: **Passive Income & Side Hustles**
- Topic 168: **Business Growth & Scaling Strategies**

### Home & Garden
- Topic 39: **Home Renovation & Improvement**
- Topic 52: **Home Storage & Organization Solutions**
- Topic 70: **Home Repairs & Maintenance**
- Topic 72: **Bathroom Renovations & Plumbing**
- Topic 78: **Kitchen Design & Renovation**
- Topic 156: **Kitchen Organization & Storage Hacks**
- Topic 166: **Custom Storage Solutions & Built-ins**
- Topic 206: **Custom Shelving & Display Solutions**

### Gaming & Entertainment
- Topic 20: **Minecraft Gameplay & Tutorials**
- Topic 24: **LEGO Building & Set Reviews**
- Topic 75: **Star Wars Fan Content & Reviews**
- Topic 99: **Gaming Commentary & Let's Plays**
- Topic 111: **Esports & Competitive Gaming**
- Topic 135: **Fortnite Gameplay & Strategies**
- Topic 141: **LEGO Star Wars Collections**
- Topic 149: **Prop Making & 3D Printed Cosplay**

## Hierarchy Insights

1. **Semantic Clustering**: The dendrogram reveals that topics cluster based on actual content similarity, not arbitrary categorization. For example, all maker/DIY content clusters together regardless of specific tools used.

2. **Natural Breakpoints**: The hierarchy has natural breakpoints at distances around 1.2, 1.4, and 1.6, suggesting 3-4 meaningful levels of categorization.

3. **Cross-Domain Merges**: Some interesting merges occur across domains at higher levels, like Disney content merging with AI/tech content, suggesting shared audience or presentation styles.

4. **Outlier Handling**: Topics with -1 designation are outliers that don't fit well into any cluster, representing unique or uncategorizable content.

## Using the Hierarchy

To explore the full interactive dendrogram:
1. Open `bertopic_hierarchy_dendrogram.html` in a web browser
2. Zoom and pan to explore different hierarchy levels
3. Click on nodes to see which topics merge at each level

The hierarchy can be used for:
- Content categorization at different granularity levels
- Understanding topic relationships
- Identifying content gaps or opportunities
- Audience segmentation based on topic preferences
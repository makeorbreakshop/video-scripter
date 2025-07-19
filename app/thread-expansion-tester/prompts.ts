// Thread Expansion Prompts based on LLM best practices

export const PROMPTS = {
  // Topic → Format expansion approach
  topicFormatExpansion: `Analyze this concept: "{concept}"

Your task: Create search queries that explore both TOPIC layers and FORMAT variations to find diverse high-performing patterns.

Step 1: Extract the core elements
- Product/Service: (e.g., "xTool F2")
- Category: (e.g., "fiber laser") 
- Broader category: (e.g., "laser engraver")
- General field: (e.g., "workshop tools")
- Human activity: (e.g., "making things")

Step 2: Identify the content format
- Is this a review? Tutorial? Unboxing? Comparison?
- What's the viewer's intent?

Step 3: Create 15 search threads

THREADS 1-3: Same topic, same format (but variations)
- Direct competitors in same format
- Similar products in same format  
- Broader category in same format

THREADS 4-6: Same topic, different formats
- If it's a review → find tutorials, vlogs, challenges with same tool
- If it's a tutorial → find reviews, comparisons, projects
- Mix entertainment formats: challenges, experiments, transformations

THREADS 7-9: Adjacent topics, same format
- Workshop tools → kitchen gadgets → tech gadgets (all reviews)
- Find what else this audience watches in same format
- Cross-pollinate from related hobbies/interests

THREADS 10-12: High-performing formats, any topic
- Challenge videos (any topic) - these get millions of views
- Story/transformation videos - personal journeys
- Versus/comparison videos - decision-making content
- List videos - "Top 10" anything

THREADS 13-15: Wild card patterns
- Viral video formats from completely different topics
- Trending formats on YouTube right now
- Entertainment formats that could work for products

Each thread: 5 specific search queries
Format: JSON with threads array containing angle, intent, and queries.`,

  formatFirstApproach: `Analyze this concept: "{concept}"

Your task: Start with the FORMAT and expand outward to find transferable patterns.

Step 1: Identify the video format
What type of video is this?
- Review → evaluating products
- Tutorial → teaching skills
- Vlog → lifestyle/journey
- Challenge → entertainment/achievement
- Comparison → decision-making
- Unboxing → first impressions
- Build/DIY → project completion

Step 2: Create 15 search threads exploring successful patterns

THREADS 1-3: Same format, related topics
Example: If it's a "laser engraver review"
- "3D printer review"
- "CNC machine review"  
- "Vinyl cutter review"

THREADS 4-6: Same format, adjacent audiences
Think: Who else watches tool reviews?
- "Camera gear review" (creators)
- "Gaming laptop review" (tech enthusiasts)
- "Kitchen appliance review" (DIYers)

THREADS 7-9: Same format, top performers
Find the most viral examples of this format:
- "iPhone review" (tech)
- "Car review" (automotive)
- "Makeup review" (beauty)

THREADS 10-12: Format variations, same intent
If people want reviews, what else satisfies that need?
- "vs" comparisons
- "buyer's guide"
- "6 months later"
- "watch before you buy"

THREADS 13-15: High-engagement formats
Pull from YouTube's most successful formats:
- Challenge videos
- Story time videos
- Day in the life vlogs
- Transformation videos
- Reaction videos

Generate 5 queries per thread focusing on finding patterns, not specific products.
Return as JSON with threads array.`,

  audiencePsychologyApproach: `Analyze this concept: "{concept}"

Your task: Think about the PERSON watching this video and what else they watch.

Step 1: Profile the viewer
- What are they trying to achieve?
- What stage of their journey are they in?
- What other interests do they have?
- What problems do they face?

Step 2: Map their YouTube consumption

THREADS 1-3: Same goal, different approaches
If they're watching "laser engraver review" they want to:
- Start a business → "Etsy shop tour", "side hustle ideas"
- Make things → "woodworking projects", "craft room tour"
- Buy equipment → "workshop setup", "tool organization"

THREADS 4-6: Same audience, different life areas
This person probably also watches:
- Business/entrepreneur content
- Home improvement videos
- Creative hobby channels
- Tech reviews
- Productivity content

THREADS 7-9: Entertainment they enjoy
What do makers/entrepreneurs watch for fun?
- Maker challenge videos
- Restoration videos
- "How it's made" content
- Success story interviews
- Behind the scenes vlogs

THREADS 10-12: Their learning journey
- Beginner: "getting started" content
- Intermediate: "tips and tricks"
- Advanced: "scaling up", "efficiency hacks"
- Business: "pricing strategies", "customer acquisition"

THREADS 13-15: Aspirational content
What do they dream about?
- "Tour of million dollar workshop"
- "Quit my job" success stories
- "From hobby to business" transformations
- "Day in the life" of successful creators

Each thread: 5 queries that this audience would search for.
Return as JSON with threads array.`,

  viralPatternMining: `Analyze this concept: "{concept}"

Your task: Find viral video patterns that could be adapted to this topic.

Step 1: Identify transferable elements
- What's the core story? (transformation, achievement, learning)
- What emotion does it target? (curiosity, desire, fear, joy)
- What's the value proposition? (save money, make money, save time, entertainment)

Step 2: Mine high-performing patterns

THREADS 1-3: Proven title formulas (any topic)
- "I tried X for 30 days"
- "X things I wish I knew before Y"
- "Why X is harder than you think"
- "$10 vs $1000 comparison"
- "Beginner vs Pro"

THREADS 4-6: Story-driven patterns
- "How I went from X to Y"
- "The truth about X"
- "What they don't tell you about X"
- "I was wrong about X"
- "X changed my life"

THREADS 7-9: Challenge/experiment patterns
- "24 hours using only X"
- "Making X until I'm successful"
- "Can X really do Y?"
- "Testing viral X hacks"
- "X myths busted"

THREADS 10-12: Educational entertainment
- "X explained in 5 levels of difficulty"
- "Expert reacts to X"
- "X tips pros don't want you to know"
- "Common X mistakes"
- "X tier list"

THREADS 13-15: Trending formats
- "POV: You're starting X"
- "Rating subscriber X"
- "X setup tour"
- "Day in the life with X"
- "X routines of successful people"

Focus on PATTERNS not specific products. Each pattern should work across many topics.
5 queries per thread. Return as JSON.`,

  // Based on Anthropic's "thinking step-by-step" and "role-playing" techniques
  stepByStep: `I need you to help me find YouTube content patterns by thinking step-by-step.

Input concept: "{concept}"

Step 1: Identify the abstract human need
- What fundamental human desire or problem is at the core?
- Ignore the specific tool/product/brand completely
- Think: What would someone want to achieve?

Step 2: Map the user journey backwards
- End goal: What transformation does the user seek?
- Middle: What skills/knowledge do they need?
- Beginning: What sparked their interest initially?

Step 3: Identify parallel journeys
- What other paths lead to the same transformation?
- What adjacent hobbies share the same satisfaction?
- What completely different tools achieve similar outcomes?

Step 4: Create 15 search threads
Each thread should progressively move from specific to broad, exploring different angles of the human journey.

Format your response as JSON with 15 threads, each containing:
- angle: The perspective being explored
- intent: What the searcher wants to learn
- queries: 5 search queries (progressively broader)

Critical: Start with the END RESULT the person wants, not the tool they're considering.`,

  // Based on OpenAI's "few-shot learning" approach
  fewShot: `Generate YouTube search queries that explore content patterns around a concept.

Example transformations:
- "DSLR camera" → photography journey, visual storytelling, memory preservation
- "Kitchen mixer" → baking passion, food creativity, home business
- "Gaming PC" → competitive gaming, content creation, digital experiences

Concept: "{concept}"

Transform this into 15 threads exploring:
1. The human story (not the product)
2. The lifestyle it represents
3. The community it connects to
4. The skills it develops
5. The dreams it enables

Rules:
- NEVER mention the specific product/brand
- Focus on human motivations and desires
- Each thread should have 5 queries
- Queries should get progressively broader
- Think about the person's entire journey

Return as JSON with 'threads' array containing objects with 'angle', 'intent', and 'queries'.`,

  // Based on "Chain of Thought" prompting
  chainOfThought: `Let's explore content patterns for: "{concept}"

First, let me think about what this really represents...

If someone is searching for this, they're probably:
- Trying to solve a problem (what problem?)
- Pursuing a passion (what passion?)
- Building something (what are they building?)
- Learning a skill (what skill?)
- Joining a community (what community?)

Now, let's forget the specific product and think about:
- What does this person do for fun?
- What are their aspirations?
- What other interests might they have?
- What stage of their journey are they in?
- What content helps them succeed?

Based on this analysis, create 15 search threads that explore:
1-3: Core human needs being met
4-6: Alternative paths to the same goal
7-9: Related interests and hobbies
10-12: Community and learning resources
13-15: Broader lifestyle and aspirations

Each thread needs 5 queries that avoid product-specific terms.
Return as JSON with threads array.`,

  // Based on "Persona-based" prompting
  personaBased: `Imagine three different people interested in "{concept}":

Person A: Complete beginner
- Doesn't know technical terms
- Motivated by a dream or goal
- Searches for inspiration and basics

Person B: Enthusiast
- Has some experience
- Wants to level up
- Searches for techniques and community

Person C: Professional
- Makes money from this
- Needs efficiency and quality
- Searches for business and advanced tips

Create 15 search threads (5 for each persona) that explore their journey WITHOUT mentioning specific products.

Focus on:
- Their motivations and dreams
- Problems they're solving
- Communities they're joining
- Skills they're developing
- Transformations they're seeking

Format: JSON with threads array, each having angle, intent, and 5 queries.`,

  // Ultra-abstract approach
  abstract: `Task: Discover YouTube content patterns through abstract exploration.

Starting point: "{concept}"

Instructions:
1. Extract the deepest human motivation (creativity? connection? achievement?)
2. Identify the transformation sought (amateur → expert? dreamer → doer?)
3. Map the ecosystem of related activities
4. Find parallel universes (different tools, same outcome)
5. Explore the full journey (inspiration → mastery)

Create 15 threads that spiral outward:
- Inner ring (1-5): Core human needs and motivations
- Middle ring (6-10): Methods, communities, and skills
- Outer ring (11-15): Lifestyle, culture, and broader interests

Important: Think like an anthropologist studying human behavior, not a marketer selling products.

Each thread: 5 queries exploring that angle.
Format: JSON structure with threads array.`,

  // Metaphorical thinking approach
  metaphorical: `Let's use metaphorical thinking to explore "{concept}".

Think of this as:
- A journey (where does it lead?)
- A tool in a toolkit (what's the full toolkit?)
- A skill tree in a game (what are the branches?)
- A ingredient in a recipe (what's the full meal?)
- A chapter in a story (what's the full narrative?)

Now create 15 threads that explore:
1-3: The destination, not the vehicle
4-6: The toolkit, not just one tool
7-9: The skill tree branches
10-12: The complete recipe
13-15: The full story arc

Never mention specific products. Focus on:
- What people create
- How they grow
- Who they become
- What they achieve
- Why they care

Return 15 threads with angle, intent, and 5 queries each as JSON.`,

  // Opus-optimized approach based on your feedback
  humanCentered: `I need help finding YouTube content patterns by understanding human behavior and motivations.

Starting point: "{concept}"

Your task: Completely ignore what this product IS and focus on WHO uses it and WHY.

Step 1: Decode the human story
- What life change is this person seeking?
- What problem keeps them up at night?
- What future are they trying to create?
- What identity are they building?

Step 2: Map their entire world
Think beyond the purchase moment:
- What did they search for BEFORE knowing this product existed?
- What will they search for AFTER mastering this tool?
- What ELSE is in their garage/office/workshop?
- What do their friends ask them for help with?
- What do they watch for entertainment (not education)?

Step 3: Find parallel universes
- Who else has these same desires but uses completely different tools?
- What hobbies have similar creative satisfaction?
- What professions solve similar problems?
- What communities share these values?

Create 15 search threads:
1-3: The person's broader identity and lifestyle
4-6: Problems they face across their whole life
7-9: Other tools in their workshop/interests
10-12: Communities and content they enjoy
13-15: Dreams and aspirations beyond this tool

Each thread needs 5 queries that explore human behavior, not product features.

Critical: If you mention any specific product, tool type, or technical category, you've failed. Think like an anthropologist studying a tribe, not a marketer selling gear.

Return as JSON with threads array containing angle, intent, and queries.`
};
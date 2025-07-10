import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Not set');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Pattern categories
const patternCategories = {
  listicles: {
    name: 'Listicles',
    patterns: [
      /^\d+\s+(?:best|worst|tips|ways|things|reasons|mistakes|secrets|facts|rules|habits|steps|signs|types|ideas|examples|lessons|skills|tricks|hacks|strategies|methods|techniques|principles|questions|characteristics|qualities|traits|features|benefits|problems|challenges|myths|lies|truths|foods|exercises|books|apps|tools|websites|resources|places|destinations|countries|cities|jobs|careers|businesses|investments|stocks|cryptocurrencies|products|brands|companies|gadgets|devices|games|movies|shows|songs|albums|artists|celebrities|influencers|youtubers|podcasts|channels|videos|memes|trends|topics|subjects|niches|industries)/i,
      /^top\s+\d+/i,
      /\d+\s+(?:best|worst|amazing|incredible|surprising|shocking|insane|crazy|weird|strange|unusual|unbelievable|mind-?blowing|life-?changing|game-?changing|must-?know|must-?have|must-?see|must-?watch|must-?read|essential|important|powerful|proven|effective|simple|easy|quick|fast)/i
    ]
  },
  howTo: {
    name: 'How-To/Tutorials',
    patterns: [
      /^how\s+(?:to|do|can|should|would|could|i|you|we)/i,
      /(?:tutorial|guide|walkthrough|masterclass|course|lesson|training|workshop|bootcamp)\s*(?:\||:|-|–)/i,
      /(?:step-?by-?step|beginners?|ultimate|complete|full|comprehensive|detailed|in-?depth|advanced|basic|quick|easy|simple|fast)\s+(?:guide|tutorial|course|training)/i,
      /^(?:learn|master|understand|discover|explore|build|create|make|develop|design|implement|install|setup|configure|optimize|improve|fix|solve|troubleshoot|debug|deploy|launch|publish|promote|market|sell|monetize|scale|grow|automate|manage|maintain|update|upgrade|migrate|integrate|connect|sync|transfer|convert|export|import|backup|restore|recover|protect|secure|encrypt|compress|extract|download|upload|stream|record|edit|render|encode|decode|analyze|test|benchmark|measure|monitor|track|log|audit|review|validate|verify|authenticate|authorize|authenticate)/i
    ]
  },
  versus: {
    name: 'Comparisons/Versus',
    patterns: [
      /\svs\.?\s/i,
      /\sversus\s/i,
      /\sor\s/i,
      /(?:which|what|who)\s+is\s+(?:better|best|worse|worst|faster|slower|stronger|weaker|bigger|smaller|cheaper|expensive|easier|harder|simpler|complex)/i,
      /(?:comparison|compare|comparing|compared|difference|differences|similar|similarities|pros?\s+(?:and|&)\s+cons?|advantages?\s+(?:and|&)\s+disadvantages?)/i,
      /(?:battle|showdown|face-?off|head-?to-?head|side-?by-?side|matchup|duel|clash|competition|contest|challenge)/i
    ]
  },
  questions: {
    name: 'Questions',
    patterns: [
      /^(?:what|why|how|when|where|who|which|whose|whom|should|could|would|can|will|is|are|was|were|do|does|did|have|has|had)\s+/i,
      /\?$/,
      /^(?:explained|explaining|explain)\s*(?:\||:|-|–)/i,
      /(?:q&a|q\s*&\s*a|faq|frequently\s+asked|ask\s+me\s+anything|ama|answering|answers?|questions?)/i
    ]
  },
  reactions: {
    name: 'Reactions/Reviews',
    patterns: [
      /(?:react|reacting|reaction|reacts)\s+to/i,
      /(?:review|reviewing|reviewed|reviews)\s*(?:\||:|-|–)/i,
      /(?:first|initial|honest|unbiased|detailed|in-?depth|comprehensive|complete|full)\s+(?:reaction|review|impressions?|thoughts?|opinions?|experience|look|listen|watch|play|test|try)/i,
      /(?:watching|listening|playing|trying|testing|using|experiencing)\s+(?:for\s+the\s+)?(?:first\s+time|1st\s+time)/i,
      /(?:my|our)\s+(?:reaction|review|thoughts?|opinions?|experience|take|perspective|analysis|breakdown|commentary|critique|evaluation|assessment|judgment|verdict|rating|score)/i
    ]
  },
  updates: {
    name: 'News/Updates',
    patterns: [
      /(?:breaking|latest|new|recent|updated?|current|today|tonight|morning|evening|daily|weekly|monthly|yearly|annual|2023|2024|2025)\s+(?:news|updates?|information|info|details|developments?|announcements?|releases?|launches?|reveals?|leaks?|rumors?|reports?|stories|coverage|headlines|alerts?|bulletins?|briefings?|summaries?|roundups?|recaps?|highlights?)/i,
      /(?:just|finally|officially|confirmed|announced|revealed|leaked|released|launched|dropped|published|posted|shared|uploaded)/i,
      /(?:live|livestream|streaming|broadcast|recording|footage|video|clip|episode|show|podcast|interview|conversation|discussion|debate|panel|talk|chat|q&a|ama)/i
    ]
  },
  challenges: {
    name: 'Challenges/Experiments',
    patterns: [
      /(?:challenge|experiment|test|trial|attempt|try|trying)\s*(?:\||:|-|–)/i,
      /(?:24\s*hours?|48\s*hours?|72\s*hours?|\d+\s*days?|\d+\s*weeks?|\d+\s*months?|\d+\s*years?)\s+(?:challenge|experiment|test|trial|without|using|eating|drinking|sleeping|working|studying|training|practicing|playing|watching|listening)/i,
      /(?:i|we)\s+(?:tried|tested|experimented|attempted|challenged|survived|lived|spent|did|made|built|created|learned|mastered)/i,
      /(?:can\s+(?:i|you|we)|trying\s+to|attempting\s+to|going\s+to)\s+(?:survive|live|last|make\s+it|complete|finish|win|beat|defeat|overcome|conquer|master|learn|build|create|earn|save|spend)/i
    ]
  },
  emotional: {
    name: 'Emotional/Clickbait',
    patterns: [
      /(?:shocking|insane|crazy|unbelievable|incredible|amazing|mind-?blowing|jaw-?dropping|stunning|breathtaking|heartbreaking|emotional|touching|inspiring|motivating|life-?changing|game-?changing)\s*(?:\||:|-|–)/i,
      /(?:you\s+won'?t\s+believe|can'?t\s+believe|won'?t\s+believe|never\s+believe|hard\s+to\s+believe)/i,
      /(?:made\s+me|makes?\s+you|will\s+make\s+you)\s+(?:cry|laugh|smile|think|question|wonder|realize|understand|appreciate|grateful|thankful|emotional|sad|happy|angry|mad|furious|scared|afraid|terrified|shocked|surprised|amazed|speechless)/i,
      /(?:gone\s+wrong|gone\s+right|gone\s+viral|went\s+viral|going\s+viral|blew\s+up|blowing\s+up|trending|viral)/i,
      /(?:exposed|exposing|revealed|revealing|uncovered|uncovering|discovered|discovering|found|finding|caught|catching|busted|busting|called\s+out|calling\s+out)/i
    ]
  },
  educational: {
    name: 'Educational/Explanatory',
    patterns: [
      /(?:explained|explaining|explanation|explains?)\s*(?:\||:|-|–)/i,
      /(?:science|history|math|physics|chemistry|biology|psychology|philosophy|economics|politics|geography|geology|astronomy|computer\s+science|engineering|medicine|health|nutrition|fitness|finance|business|marketing|technology|programming|coding|design|art|music|literature|language|culture|religion|spirituality)\s+(?:of|behind|in|for|101|basics|fundamentals|principles|concepts|theories|facts|lessons)/i,
      /(?:everything\s+you\s+need\s+to\s+know|all\s+you\s+need\s+to\s+know|what\s+you\s+need\s+to\s+know|things\s+you\s+(?:need|should|must)\s+know)/i,
      /(?:deep\s+dive|crash\s+course|masterclass|lecture|presentation|seminar|webinar|workshop|bootcamp|intensive|immersive)/i
    ]
  },
  personal: {
    name: 'Personal/Lifestyle',
    patterns: [
      /^(?:my|our)\s+(?:story|journey|experience|life|day|week|month|year|morning|evening|night|routine|ritual|schedule|setup|workspace|desk|room|house|home|apartment|studio|office|car|bike|trip|travel|vacation|adventure)/i,
      /(?:day\s+in\s+(?:the\s+)?life|week\s+in\s+(?:the\s+)?life|morning\s+routine|night\s+routine|daily\s+routine|workout\s+routine|skincare\s+routine|productivity\s+routine)/i,
      /(?:room\s+tour|house\s+tour|apartment\s+tour|studio\s+tour|office\s+tour|setup\s+tour|workspace\s+tour|desk\s+setup|gaming\s+setup|streaming\s+setup|youtube\s+setup|content\s+creator\s+setup)/i,
      /(?:transformation|glow\s+up|makeover|renovation|redesign|reorganize|declutter|minimize|simplify|optimize|upgrade|update)/i
    ]
  },
  series: {
    name: 'Series/Episodes',
    patterns: [
      /(?:episode|ep\.?|part|pt\.?|chapter|ch\.?|season|s\.?|vol\.?|volume)\s*#?\s*\d+/i,
      /\s#\d+(?:\s|$)/,
      /(?:week|day|month|year)\s+\d+\s*(?:\||:|-|–)/i,
      /\[\s*\d+\s*(?:\/|of)\s*\d+\s*\]/,
      /\(\s*\d+\s*(?:\/|of)\s*\d+\s*\)/
    ]
  },
  gaming: {
    name: 'Gaming',
    patterns: [
      /(?:let'?s\s+play|playthrough|walkthrough|gameplay|game\s+play|full\s+game|campaign|story\s+mode|multiplayer|online|pvp|pve|speedrun|speed\s+run|no\s+damage|no\s+hit|100%|all\s+achievements|platinum\s+trophy)/i,
      /(?:minecraft|fortnite|roblox|gta|call\s+of\s+duty|cod|warzone|apex|valorant|league\s+of\s+legends|lol|csgo|counter-?strike|overwatch|pubg|fifa|nba|madden|pokemon|zelda|mario|sonic|resident\s+evil|dark\s+souls|elden\s+ring)/i,
      /(?:gaming|gamer|games?|video\s+games?|pc\s+gaming|console\s+gaming|mobile\s+gaming|indie\s+games?|aaa\s+games?|retro\s+games?|classic\s+games?)/i
    ]
  },
  timestamps: {
    name: 'Time-based',
    patterns: [
      /(?:in\s+)?(?:under|less\s+than|only|just)?\s*\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)/i,
      /(?:quick|short|brief|fast|rapid|speedy)\s+(?:guide|tutorial|explanation|summary|recap|review|look|overview)/i,
      /\d+:\d{2}(?::\d{2})?/,
      /(?:timestamps?|time\s*stamps?|chapters?|sections?|parts?)\s+(?:in|below|included|added|available)/i
    ]
  },
  money: {
    name: 'Money/Finance',
    patterns: [
      /\$\s*[\d,]+(?:\.\d{2})?(?:k|m|b)?/i,
      /(?:how\s+to\s+)?(?:make|earn|save|invest|spend|waste|lose|win|get|receive|claim|withdraw)\s+(?:money|\$|dollars?|cash|income|revenue|profit|millions?|billions?|thousands?)/i,
      /(?:rich|wealth|wealthy|millionaire|billionaire|broke|poor|debt|loan|credit|finance|financial|investment|investing|trading|stocks?|crypto|bitcoin|ethereum|nft|passive\s+income|side\s+hustle|business|entrepreneur|startup)/i,
      /(?:budget|budgeting|saving|savings|spending|expenses|bills|taxes|retirement|401k|ira|portfolio|diversify|compound|interest|dividend|yield|return|roi|profit|loss|risk|reward)/i
    ]
  },
  tech: {
    name: 'Technology',
    patterns: [
      /(?:iphone|android|samsung|google|apple|microsoft|amazon|tesla|meta|facebook|instagram|twitter|tiktok|youtube|netflix|spotify|windows|mac|linux|ai|artificial\s+intelligence|machine\s+learning|blockchain|vr|virtual\s+reality|ar|augmented\s+reality|5g|internet|wifi|bluetooth|usb|hdmi)/i,
      /(?:app|apps|application|software|hardware|device|gadget|tech|technology|innovation|digital|smart|iot|cloud|server|database|api|sdk|framework|library|programming|coding|developer|development|code|script|algorithm|data|analytics|cybersecurity|security|privacy|encryption|vpn|firewall|antivirus|malware|ransomware|phishing|hack|hacking|hacker)/i,
      /(?:review|unboxing|setup|install|configure|customize|optimize|troubleshoot|fix|repair|upgrade|update|patch|mod|hack|jailbreak|root|overclock)/i
    ]
  },
  fitness: {
    name: 'Fitness/Health',
    patterns: [
      /(?:workout|exercise|training|gym|fitness|cardio|strength|muscle|abs|arms|legs|chest|back|shoulders|core|hiit|crossfit|yoga|pilates|running|cycling|swimming|walking|stretching|warm\s*up|cool\s*down)/i,
      /(?:diet|nutrition|meal|food|eating|calories|protein|carbs|fat|vitamins|minerals|supplements|weight\s+loss|weight\s+gain|bulk|cut|lean|shred|tone|transform|transformation|before\s+(?:and|&)\s+after|results|progress)/i,
      /(?:health|healthy|wellness|wellbeing|mental\s+health|physical\s+health|self\s*care|meditation|mindfulness|stress|anxiety|depression|sleep|energy|motivation|habits|routine|lifestyle)/i
    ]
  },
  entertainment: {
    name: 'Entertainment/Pop Culture',
    patterns: [
      /(?:movie|film|show|series|episode|season|trailer|teaser|review|reaction|breakdown|analysis|explained|ending|theory|theories|spoiler|spoilers|cast|actor|actress|director|producer|writer|character|plot|story|scene)/i,
      /(?:music|song|album|artist|band|singer|rapper|producer|beat|remix|cover|acoustic|live|performance|concert|tour|festival|awards|grammy|oscar|emmy|golden\s+globe)/i,
      /(?:celebrity|celeb|star|famous|fame|scandal|drama|controversy|gossip|rumor|news|update|relationship|dating|married|divorced|pregnant|baby|kids|family|friends)/i
    ]
  },
  vlog: {
    name: 'Vlogs',
    patterns: [
      /(?:vlog|v-?log|daily\s+vlog|weekly\s+vlog|travel\s+vlog|family\s+vlog|couple\s+vlog)/i,
      /(?:come\s+with\s+me|follow\s+me|join\s+me|spend\s+(?:the|a)\s+day|day\s+with\s+me|week\s+with\s+me|behind\s+the\s+scenes|bts)/i,
      /(?:vlogmas|vlogtober|summer\s+vlog|spring\s+vlog|fall\s+vlog|winter\s+vlog|holiday\s+vlog|vacation\s+vlog|birthday\s+vlog|anniversary\s+vlog)/i
    ]
  },
  food: {
    name: 'Food/Cooking',
    patterns: [
      /(?:recipe|cooking|baking|chef|kitchen|food|meal|dish|cuisine|restaurant|cafe|bakery|menu|taste|tasting|eating|mukbang|asmr)/i,
      /(?:how\s+to\s+(?:cook|bake|make|prepare)|easy|quick|simple|delicious|tasty|yummy|homemade|authentic|traditional|modern|fusion|vegan|vegetarian|keto|paleo|gluten\s*free|dairy\s*free|sugar\s*free|healthy|low\s*carb|high\s*protein)/i,
      /(?:breakfast|lunch|dinner|snack|dessert|appetizer|main\s+course|side\s+dish|salad|soup|sandwich|pizza|pasta|burger|steak|chicken|fish|seafood|vegetables|fruits|bread|cake|cookies|ice\s*cream)/i
    ]
  },
  beauty: {
    name: 'Beauty/Fashion',
    patterns: [
      /(?:makeup|make\s*up|beauty|skincare|skin\s*care|haircare|hair\s*care|nails|manicure|pedicure|cosmetics|products|routine|tutorial|tips|tricks|hacks|transformation|makeover|glow\s*up)/i,
      /(?:fashion|style|outfit|ootd|lookbook|haul|try\s*on|wardrobe|closet|clothes|clothing|accessories|shoes|bags|jewelry|trends|trendy|chic|elegant|casual|formal|streetwear|vintage|thrift)/i,
      /(?:grwm|get\s+ready\s+with\s+me|morning\s+routine|night\s+routine|skincare\s+routine|makeup\s+routine|hair\s+routine|self\s*care\s+routine)/i
    ]
  },
  education: {
    name: 'Education/Learning',
    patterns: [
      /(?:study|studying|student|school|college|university|class|course|lesson|lecture|exam|test|quiz|homework|assignment|project|presentation|research|thesis|dissertation|degree|graduation|graduate|education|academic|scholarship)/i,
      /(?:learn|learning|teach|teaching|teacher|professor|instructor|tutor|mentor|coach|training|workshop|seminar|webinar|conference|summit|bootcamp|certification|certificate|diploma|qualification)/i,
      /(?:online\s+course|online\s+class|online\s+learning|e-?learning|mooc|coursera|udemy|khan\s+academy|skillshare|masterclass|linkedin\s+learning)/i
    ]
  },
  business: {
    name: 'Business/Entrepreneurship',
    patterns: [
      /(?:business|entrepreneur|startup|company|corporation|enterprise|venture|project|product|service|brand|marketing|sales|revenue|profit|growth|scale|strategy|plan|model|lean|agile|mvp|pivot|launch|exit)/i,
      /(?:ceo|founder|co-?founder|executive|manager|director|leader|leadership|team|culture|hiring|recruiting|employee|staff|freelance|contractor|consultant|agency|firm|office|remote|work\s+from\s+home|wfh)/i,
      /(?:market|industry|sector|niche|competition|competitor|customer|client|user|audience|target|segment|persona|journey|experience|satisfaction|retention|acquisition|conversion|funnel|metrics|kpi|roi|ltv|cac|mrr|arr)/i
    ]
  },
  diy: {
    name: 'DIY/Crafts',
    patterns: [
      /(?:diy|d\.i\.y\.|do\s+it\s+yourself|homemade|handmade|craft|crafts|crafting|project|build|building|make|making|create|creating|design|designing)/i,
      /(?:woodworking|metalworking|sewing|knitting|crochet|embroidery|painting|drawing|art|sculpture|pottery|ceramics|jewelry|beading|scrapbooking|origami|paper\s+craft)/i,
      /(?:home\s+improvement|renovation|remodel|decor|decoration|interior\s+design|furniture|garden|gardening|landscape|outdoor|patio|deck|shed|workshop|garage)/i
    ]
  },
  travel: {
    name: 'Travel/Adventure',
    patterns: [
      /(?:travel|traveling|trip|journey|adventure|explore|exploring|destination|vacation|holiday|tour|tourist|tourism|backpacking|road\s*trip|cruise|flight|hotel|hostel|airbnb|accommodation)/i,
      /(?:country|city|town|village|island|beach|mountain|desert|forest|jungle|lake|river|ocean|sea|park|monument|landmark|attraction|museum|temple|church|castle|palace)/i,
      /(?:itinerary|guide|tips|budget|cheap|expensive|luxury|solo|couple|family|group|local|culture|food|language|currency|visa|passport|packing|luggage|suitcase)/i
    ]
  },
  motivation: {
    name: 'Motivation/Self-Help',
    patterns: [
      /(?:motivation|motivational|inspire|inspiring|inspiration|inspirational|encourage|encouraging|encouragement|empower|empowering|empowerment|uplift|uplifting|positive|positivity|mindset|attitude|belief|confidence|self-?esteem|self-?worth|self-?love|self-?care|self-?improvement|personal\s+development|personal\s+growth)/i,
      /(?:success|successful|achieve|achievement|accomplish|accomplishment|goal|goals|dream|dreams|vision|mission|purpose|passion|drive|determination|perseverance|resilience|grit|hustle|grind|discipline|consistency|habit|habits|routine|morning\s+routine|daily\s+routine)/i,
      /(?:change\s+your\s+life|transform\s+your\s+life|improve\s+your\s+life|better\s+life|best\s+life|dream\s+life|ideal\s+life|perfect\s+life|happy\s+life|fulfilled\s+life|meaningful\s+life|purposeful\s+life)/i
    ]
  },
  relationship: {
    name: 'Relationships/Dating',
    patterns: [
      /(?:relationship|relationships|dating|date|dates|love|romance|romantic|couple|couples|boyfriend|girlfriend|husband|wife|partner|spouse|marriage|married|wedding|engagement|engaged|proposal|propose|anniversary|valentine|breakup|break\s*up|divorce|ex|crush|flirt|flirting|attraction|chemistry|compatibility)/i,
      /(?:advice|tips|signs|red\s+flags|green\s+flags|toxic|healthy|communication|trust|loyalty|commitment|intimacy|sex|sexuality|lgbtq|gay|lesbian|bisexual|transgender|queer|pride)/i,
      /(?:single|singles|bachelor|bachelorette|tinder|bumble|hinge|match|online\s+dating|dating\s+app|first\s+date|blind\s+date|speed\s+dating|long\s+distance|ldr)/i
    ]
  },
  parenting: {
    name: 'Parenting/Family',
    patterns: [
      /(?:parent|parenting|mom|mother|dad|father|parents|family|families|child|children|kid|kids|baby|babies|toddler|toddlers|teen|teenager|adolescent|son|daughter|sibling|brother|sister|grandparent|grandma|grandpa|grandmother|grandfather)/i,
      /(?:pregnancy|pregnant|expecting|maternity|birth|labor|delivery|newborn|infant|nursery|breastfeeding|formula|diaper|sleep\s+training|potty\s+training|milestone|development|growth|education|school|homework|activities|sports|hobbies|play|toys|games)/i,
      /(?:discipline|behavior|tantrums|manners|respect|responsibility|chores|allowance|screen\s+time|bedtime|routine|schedule|meal|snack|nutrition|health|safety|childproof|car\s+seat|stroller|crib|high\s+chair)/i
    ]
  },
  pets: {
    name: 'Pets/Animals',
    patterns: [
      /(?:pet|pets|animal|animals|dog|dogs|puppy|puppies|cat|cats|kitten|kittens|bird|birds|fish|hamster|guinea\s+pig|rabbit|bunny|turtle|snake|lizard|reptile|exotic|rescue|adopt|adoption|shelter|breed|breeder|pedigree)/i,
      /(?:training|train|trained|obedience|tricks|commands|behavior|aggressive|friendly|playful|energetic|lazy|smart|intelligent|loyal|protective|loving|cute|adorable|funny|hilarious|compilation|fail|fails)/i,
      /(?:care|caring|grooming|bathing|feeding|food|diet|treats|toys|bed|crate|leash|collar|harness|vet|veterinary|health|medicine|vaccine|vaccination|spay|neuter|microchip)/i
    ]
  },
  music: {
    name: 'Music/Audio',
    patterns: [
      /(?:official\s+)?(?:music\s+video|audio|lyric\s+video|lyrics|visualizer|live\s+performance|acoustic|cover|remix|mashup|instrumental|karaoke|behind\s+the\s+scenes|making\s+of)/i,
      /(?:feat\.?|featuring|ft\.?|prod\.?|produced\s+by|directed\s+by|shot\s+by|edit\s+by|mixed\s+by|mastered\s+by)/i,
      /(?:album|ep|single|mixtape|playlist|tracklist|song|track|beat|melody|rhythm|bass|drums|guitar|piano|vocals|rap|hip\s*hop|r&b|pop|rock|metal|jazz|classical|electronic|edm|house|techno|dubstep|trap|drill|afrobeat|reggae|country|folk|indie|alternative)/i
    ]
  },
  sports: {
    name: 'Sports',
    patterns: [
      /(?:sports?|game|match|tournament|championship|league|season|playoffs|finals|semi-?finals|quarter-?finals|round|heat|race|competition|contest|event|olympic|world\s+cup|super\s+bowl|world\s+series|stanley\s+cup|nba|nfl|nhl|mlb|fifa|uefa|premier\s+league|la\s+liga|serie\s+a|bundesliga|ligue\s+1)/i,
      /(?:football|soccer|basketball|baseball|hockey|tennis|golf|cricket|rugby|volleyball|boxing|mma|ufc|wrestling|swimming|running|track|field|marathon|triathlon|cycling|skiing|snowboarding|surfing|skateboarding|gymnastics|weightlifting|powerlifting|bodybuilding|crossfit)/i,
      /(?:team|player|athlete|coach|manager|referee|umpire|score|goal|point|win|loss|draw|tie|victory|defeat|champion|winner|loser|underdog|favorite|odds|bet|betting|fantasy|draft|trade|transfer|contract|salary|injury|comeback|retirement)/i
    ]
  },
  science: {
    name: 'Science/Technology',
    patterns: [
      /(?:science|scientific|scientist|research|researcher|study|studies|experiment|experiments|lab|laboratory|theory|hypothesis|evidence|proof|discovery|invention|innovation|breakthrough|finding|result|conclusion|peer\s+review|journal|paper|publication)/i,
      /(?:physics|chemistry|biology|astronomy|geology|meteorology|oceanography|ecology|environmental|climate|space|nasa|spacex|rocket|satellite|telescope|microscope|quantum|relativity|evolution|genetics|dna|cell|molecule|atom|particle|energy|matter|force|gravity|light|sound|heat|electricity|magnetism)/i,
      /(?:technology|tech|engineering|engineer|computer|computing|software|hardware|ai|artificial\s+intelligence|machine\s+learning|deep\s+learning|neural\s+network|algorithm|data|database|cloud|server|network|internet|web|app|application|program|code|coding|programming|developer|development)/i
    ]
  },
  history: {
    name: 'History/Documentary',
    patterns: [
      /(?:history|historical|historian|ancient|medieval|modern|contemporary|prehistoric|stone\s+age|bronze\s+age|iron\s+age|classical|renaissance|industrial|revolution|war|battle|conflict|peace|treaty|empire|kingdom|dynasty|civilization|culture|society|archaeology|artifact|ruins|discovery|excavation)/i,
      /(?:documentary|documentaries|biography|biographies|story|stories|true\s+story|real\s+story|untold\s+story|forgotten|lost|hidden|secret|mystery|mysteries|conspiracy|theory|theories|myth|legend|folklore|tradition)/i,
      /(?:bc|bce|ad|ce|century|decade|year|era|period|age|epoch|timeline|chronology|event|events|people|person|figure|leader|king|queen|emperor|president|general|hero|villain|explorer|inventor|artist|writer|philosopher|scientist)/i
    ]
  },
  comedy: {
    name: 'Comedy/Humor',
    patterns: [
      /(?:funny|hilarious|comedy|comedian|humor|humorous|joke|jokes|prank|pranks|pranking|pranked|fail|fails|blooper|bloopers|meme|memes|viral|trending|roast|roasting|roasted|burn|burns|savage|skit|sketch|parody|satire|impression|impressions|stand\s*up|standup|improv|improvisation)/i,
      /(?:try\s+not\s+to\s+laugh|try\s+not\s+to\s+smile|you\s+laugh\s+you\s+lose|ylyl|funny\s+moments|best\s+moments|funniest\s+moments|compilation|montage|highlights|fails\s+compilation|wins\s+compilation|satisfying|oddly\s+satisfying|cringe|cringy|awkward|embarrassing)/i,
      /(?:tiktok|tik\s*tok|vine|vines|instagram|reels|shorts|youtube\s+shorts|meme\s+review|meme\s+compilation|dank\s+memes|spicy\s+memes|fresh\s+memes)/i
    ]
  },
  horror: {
    name: 'Horror/Mystery',
    patterns: [
      /(?:horror|scary|creepy|spooky|frightening|terrifying|nightmare|ghost|ghosts|haunted|haunting|paranormal|supernatural|demon|demons|evil|dark|darkness|shadow|shadows|monster|monsters|creature|creatures|zombie|zombies|vampire|vampires|werewolf|witch|witches|curse|cursed|possession|possessed|exorcism|exorcist)/i,
      /(?:true\s+crime|crime|criminal|killer|murder|murdered|serial\s+killer|psychopath|sociopath|investigation|investigate|detective|police|fbi|cia|case|cases|unsolved|mystery|mysteries|missing|disappeared|vanished|kidnapped|abducted|conspiracy|theory|theories|coverup|cover\s*up|scandal)/i,
      /(?:urban\s+legend|urban\s+legends|myth|myths|folklore|cryptid|cryptids|bigfoot|sasquatch|loch\s+ness|alien|aliens|ufo|ufos|area\s+51|illuminati|secret\s+society|cult|occult|ritual|sacrifice|ouija|seance|medium|psychic|clairvoyant)/i
    ]
  },
  asmr: {
    name: 'ASMR',
    patterns: [
      /(?:asmr|autonomous\s+sensory\s+meridian\s+response|tingles|triggers|whisper|whispering|soft\s+spoken|mouth\s+sounds|tapping|scratching|brushing|crinkling|eating\s+sounds|mukbang|roleplay|role\s+play|personal\s+attention|spa|massage|haircut|medical|doctor|cranial\s+nerve|sleep|relaxation|relax|relaxing|calming|soothing|gentle|peaceful|quiet|ambient)/i,
      /(?:3d\s+audio|binaural|ear\s+to\s+ear|close\s+up|zoom|mic|microphone|blue\s+yeti|rode|audio\s+quality|high\s+quality|4k|hd|no\s+talking|no\s+music|rain|nature|white\s+noise|brown\s+noise|pink\s+noise)/i
    ]
  },
  podcast: {
    name: 'Podcast/Talk Show',
    patterns: [
      /(?:podcast|podcasts|episode|ep\.|show|talk\s+show|interview|interviews|conversation|conversations|discussion|discussions|debate|debates|guest|guests|host|hosts|co-?host|panel|panelist|roundtable|q&a|q\s*and\s*a|ama|ask\s+me\s+anything)/i,
      /(?:joe\s+rogan|jre|h3|impaulsive|logan\s+paul|jake\s+paul|david\s+dobrik|views|mrbeast|pewdiepie|markiplier|jacksepticeye|game\s+grumps|good\s+mythical\s+morning|gmm|hot\s+ones|first\s+we\s+feast|breakfast\s+club|drink\s+champs|flagrant|brilliant\s+idiots|your\s+mom'?s\s+house)/i
    ]
  },
  animation: {
    name: 'Animation/Anime',
    patterns: [
      /(?:animation|animated|anime|manga|cartoon|cartoons|2d|3d|cgi|pixar|disney|dreamworks|studio\s+ghibli|netflix|crunchyroll|funimation|viz|shonen|shounen|shojo|shoujo|seinen|josei|isekai|mecha|slice\s+of\s+life|romance|action|adventure|fantasy|sci-?fi|horror|comedy|drama|thriller|mystery|psychological)/i,
      /(?:naruto|one\s+piece|bleach|dragon\s+ball|attack\s+on\s+titan|my\s+hero\s+academia|demon\s+slayer|jujutsu\s+kaisen|tokyo\s+ghoul|death\s+note|fullmetal\s+alchemist|sword\s+art\s+online|hunter\s+x\s+hunter|haikyuu|black\s+clover|fairy\s+tail|one\s+punch\s+man|mob\s+psycho|steins\s+gate|code\s+geass|evangelion|cowboy\s+bebop|jojo|chainsaw\s+man)/i,
      /(?:episode|ep|ova|movie|film|season|arc|saga|opening|op|ending|ed|ost|soundtrack|amv|anime\s+music\s+video|sub|subbed|dub|dubbed|english|japanese|reaction|review|analysis|theory|theories|explained|discussion|ranking|top\s+10|best|worst|underrated|overrated|tier\s+list)/i
    ]
  },
  news: {
    name: 'News/Current Events',
    patterns: [
      /(?:news|breaking\s+news|latest\s+news|current\s+events|headlines|report|reports|reporting|reporter|journalist|journalism|media|press|coverage|story|stories|update|updates|announcement|announced|statement|press\s+release|briefing|conference|interview|exclusive|investigation|investigative|expose|leak|leaked|whistleblower)/i,
      /(?:politics|political|politician|government|president|prime\s+minister|congress|senate|parliament|election|elections|campaign|candidate|vote|voting|voter|poll|polls|polling|debate|policy|policies|law|laws|legislation|bill|amendment|constitution|democracy|democratic|republican|conservative|liberal|left|right|center|moderate|progressive|socialist|capitalist)/i,
      /(?:economy|economic|finance|financial|market|markets|stock|stocks|bond|bonds|crypto|cryptocurrency|bitcoin|ethereum|inflation|recession|gdp|unemployment|job|jobs|employment|trade|tariff|tax|taxes|budget|debt|deficit|stimulus|bailout|fed|federal\s+reserve|interest\s+rate|dow|s&p|nasdaq)/i
    ]
  },
  technology_review: {
    name: 'Tech Reviews/Unboxings',
    patterns: [
      /(?:unboxing|unbox|first\s+look|first\s+impressions|hands\s*on|hands-?on|review|reviewing|reviewed|in-?depth\s+review|detailed\s+review|honest\s+review|full\s+review|quick\s+review|mini\s+review|comparison|vs\.?|versus|better|worth|buy|buying|purchase|price|cost|value|cheap|expensive|budget|premium|pro|max|ultra|plus|mini|air|se)/i,
      /(?:iphone|galaxy|pixel|oneplus|xiaomi|huawei|oppo|vivo|realme|nokia|motorola|lg|sony|asus|lenovo|dell|hp|acer|msi|razer|alienware|macbook|surface|thinkpad|chromebook|ipad|tablet|kindle|watch|airpods|earbuds|headphones|speaker|camera|drone|gimbal|tripod|microphone|keyboard|mouse|monitor|tv|projector|router|modem|nas|ssd|hdd|ram|cpu|gpu|motherboard|case|psu|cooler)/i
    ]
  }
};

// Analysis functions
function analyzeTitle(title) {
  const results = {
    title,
    matchedCategories: [],
    characteristics: {
      length: title.length,
      wordCount: title.split(/\s+/).length,
      hasNumbers: /\d/.test(title),
      hasEmoji: /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(title),
      hasCaps: title !== title.toLowerCase() && title !== title.toUpperCase(),
      allCaps: title === title.toUpperCase(),
      hasSpecialChars: /[!@#$%^&*()_+=\[\]{};':"\\|,.<>\/?]/.test(title),
      hasPipe: /\|/.test(title),
      hasColon: /:/.test(title),
      hasDash: /[-–—]/.test(title),
      hasParentheses: /[\(\)]/.test(title),
      hasBrackets: /[\[\]]/.test(title),
      hasQuotes: /["']/.test(title),
      startsWithNumber: /^\d/.test(title),
      endsWithNumber: /\d$/.test(title),
      hasYear: /\b(19|20)\d{2}\b/.test(title),
      hasHashtag: /#\w+/.test(title),
      hasMention: /@\w+/.test(title)
    }
  };

  // Check all pattern categories
  for (const [key, category] of Object.entries(patternCategories)) {
    for (const pattern of category.patterns) {
      if (pattern.test(title)) {
        results.matchedCategories.push({
          category: category.name,
          pattern: pattern.toString()
        });
        break; // Only match once per category
      }
    }
  }

  return results;
}

async function processAllTitles() {
  console.log('Starting comprehensive video title analysis...\n');
  
  const batchSize = 5000;
  let offset = 0;
  let allAnalyses = [];
  let categoryStats = {};
  let unmatched = [];
  
  // Initialize category stats
  for (const category of Object.values(patternCategories)) {
    categoryStats[category.name] = { count: 0, examples: [] };
  }
  categoryStats['Unmatched'] = { count: 0, examples: [] };

  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('title')
      .range(offset, offset + batchSize - 1)
      .order('id');
    
    if (error) {
      console.error('Error fetching data:', error);
      break;
    }
    
    if (!data || data.length === 0) {
      break;
    }
    
    console.log(`Processing batch ${offset / batchSize + 1} (${offset + 1}-${offset + data.length})...`);
    
    // Analyze each title
    for (const video of data) {
      if (!video.title) continue;
      
      const analysis = analyzeTitle(video.title);
      allAnalyses.push(analysis);
      
      if (analysis.matchedCategories.length === 0) {
        categoryStats['Unmatched'].count++;
        if (categoryStats['Unmatched'].examples.length < 100) {
          categoryStats['Unmatched'].examples.push(video.title);
        }
        unmatched.push(analysis);
      } else {
        // Count primary category (first match)
        const primaryCategory = analysis.matchedCategories[0].category;
        categoryStats[primaryCategory].count++;
        if (categoryStats[primaryCategory].examples.length < 50) {
          categoryStats[primaryCategory].examples.push(video.title);
        }
      }
    }
    
    offset += batchSize;
  }
  
  // Analyze unmatched titles for patterns
  console.log('\n\nAnalyzing unmatched titles for patterns...\n');
  
  const unmatchedPatterns = {};
  
  for (const analysis of unmatched) {
    const title = analysis.title;
    
    // Look for common starting words
    const firstWord = title.split(/\s+/)[0].toLowerCase();
    if (!unmatchedPatterns.firstWords) unmatchedPatterns.firstWords = {};
    unmatchedPatterns.firstWords[firstWord] = (unmatchedPatterns.firstWords[firstWord] || 0) + 1;
    
    // Look for common ending patterns
    const lastWord = title.split(/\s+/).pop().toLowerCase();
    if (!unmatchedPatterns.lastWords) unmatchedPatterns.lastWords = {};
    unmatchedPatterns.lastWords[lastWord] = (unmatchedPatterns.lastWords[lastWord] || 0) + 1;
    
    // Look for common phrases (2-3 word combinations)
    const words = title.toLowerCase().split(/\s+/);
    if (!unmatchedPatterns.bigrams) unmatchedPatterns.bigrams = {};
    if (!unmatchedPatterns.trigrams) unmatchedPatterns.trigrams = {};
    
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words.slice(i, i + 2).join(' ');
      unmatchedPatterns.bigrams[bigram] = (unmatchedPatterns.bigrams[bigram] || 0) + 1;
      
      if (i < words.length - 2) {
        const trigram = words.slice(i, i + 3).join(' ');
        unmatchedPatterns.trigrams[trigram] = (unmatchedPatterns.trigrams[trigram] || 0) + 1;
      }
    }
    
    // Characteristics patterns
    if (!unmatchedPatterns.characteristics) unmatchedPatterns.characteristics = {};
    for (const [char, value] of Object.entries(analysis.characteristics)) {
      if (value === true) {
        unmatchedPatterns.characteristics[char] = (unmatchedPatterns.characteristics[char] || 0) + 1;
      }
    }
  }
  
  // Generate report
  const totalVideos = allAnalyses.length;
  const matchedCount = totalVideos - categoryStats['Unmatched'].count;
  const matchRate = (matchedCount / totalVideos * 100).toFixed(2);
  
  let report = `# Comprehensive Video Title Format Analysis\n\n`;
  report += `## Summary\n`;
  report += `- Total videos analyzed: ${totalVideos.toLocaleString()}\n`;
  report += `- Matched titles: ${matchedCount.toLocaleString()} (${matchRate}%)\n`;
  report += `- Unmatched titles: ${categoryStats['Unmatched'].count.toLocaleString()} (${(100 - matchRate).toFixed(2)}%)\n\n`;
  
  report += `## Category Distribution\n\n`;
  const sortedCategories = Object.entries(categoryStats)
    .sort((a, b) => b[1].count - a[1].count);
  
  for (const [category, stats] of sortedCategories) {
    const percentage = (stats.count / totalVideos * 100).toFixed(2);
    report += `### ${category}: ${stats.count.toLocaleString()} (${percentage}%)\n`;
    if (stats.examples.length > 0) {
      report += `Examples:\n`;
      stats.examples.slice(0, 5).forEach(example => {
        report += `- "${example}"\n`;
      });
      report += `\n`;
    }
  }
  
  // Unmatched patterns analysis
  report += `## Unmatched Title Patterns Analysis\n\n`;
  
  report += `### Most Common Starting Words (Unmatched)\n`;
  const topFirstWords = Object.entries(unmatchedPatterns.firstWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  topFirstWords.forEach(([word, count]) => {
    report += `- "${word}": ${count} occurrences\n`;
  });
  
  report += `\n### Most Common Ending Words (Unmatched)\n`;
  const topLastWords = Object.entries(unmatchedPatterns.lastWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  topLastWords.forEach(([word, count]) => {
    report += `- "${word}": ${count} occurrences\n`;
  });
  
  report += `\n### Most Common Bigrams (Unmatched)\n`;
  const topBigrams = Object.entries(unmatchedPatterns.bigrams)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 10)
    .slice(0, 20);
  topBigrams.forEach(([phrase, count]) => {
    report += `- "${phrase}": ${count} occurrences\n`;
  });
  
  report += `\n### Most Common Trigrams (Unmatched)\n`;
  const topTrigrams = Object.entries(unmatchedPatterns.trigrams)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, count]) => count > 5)
    .slice(0, 20);
  topTrigrams.forEach(([phrase, count]) => {
    report += `- "${phrase}": ${count} occurrences\n`;
  });
  
  report += `\n### Characteristics of Unmatched Titles\n`;
  const totalUnmatched = categoryStats['Unmatched'].count;
  Object.entries(unmatchedPatterns.characteristics)
    .sort((a, b) => b[1] - a[1])
    .forEach(([char, count]) => {
      const percentage = (count / totalUnmatched * 100).toFixed(2);
      report += `- ${char}: ${count} (${percentage}%)\n`;
    });
  
  // Discovered patterns from unmatched
  report += `\n## Newly Discovered Patterns\n\n`;
  report += `Based on the analysis of unmatched titles, here are potential new patterns to consider:\n\n`;
  
  // Analyze for specific patterns
  const newPatterns = [];
  
  // Check for foreign language content
  if (unmatchedPatterns.firstWords['【'] > 10 || unmatchedPatterns.characteristics.hasSpecialChars > totalUnmatched * 0.3) {
    newPatterns.push({
      name: 'Foreign Language/Special Characters',
      description: 'Titles with non-English characters or special formatting',
      examples: unmatched.filter(a => /[^\x00-\x7F]/.test(a.title)).slice(0, 5).map(a => a.title)
    });
  }
  
  // Check for product names/brands
  const brandWords = ['samsung', 'apple', 'google', 'microsoft', 'sony', 'nintendo', 'tesla', 'nike', 'adidas'];
  const brandCount = Object.entries(unmatchedPatterns.firstWords)
    .filter(([word]) => brandWords.some(brand => word.includes(brand)))
    .reduce((sum, [_, count]) => sum + count, 0);
  
  if (brandCount > 50) {
    newPatterns.push({
      name: 'Brand/Product Focused',
      description: 'Titles starting with or featuring prominent brand names',
      examples: unmatched.filter(a => brandWords.some(brand => a.title.toLowerCase().includes(brand))).slice(0, 5).map(a => a.title)
    });
  }
  
  // Check for livestream/live content
  const liveCount = unmatched.filter(a => /\blive\b/i.test(a.title) && !a.matchedCategories.some(m => m.category === 'News/Updates')).length;
  if (liveCount > 100) {
    newPatterns.push({
      name: 'Live Content',
      description: 'Live streams and live content not caught by news patterns',
      examples: unmatched.filter(a => /\blive\b/i.test(a.title)).slice(0, 5).map(a => a.title)
    });
  }
  
  // Check for short/minimal titles
  const shortTitles = unmatched.filter(a => a.characteristics.wordCount <= 3).length;
  if (shortTitles > 500) {
    newPatterns.push({
      name: 'Minimal/Short Titles',
      description: 'Very short titles (3 words or less)',
      examples: unmatched.filter(a => a.characteristics.wordCount <= 3).slice(0, 10).map(a => a.title)
    });
  }
  
  // Check for name-based titles
  const nameCount = unmatched.filter(a => {
    const words = a.title.split(/\s+/);
    return words.length <= 4 && words.some(w => /^[A-Z][a-z]+$/.test(w));
  }).length;
  
  if (nameCount > 200) {
    newPatterns.push({
      name: 'Name/Person Focused',
      description: 'Titles that are primarily names or person-focused',
      examples: unmatched.filter(a => {
        const words = a.title.split(/\s+/);
        return words.length <= 4 && words.some(w => /^[A-Z][a-z]+$/.test(w));
      }).slice(0, 5).map(a => a.title)
    });
  }
  
  newPatterns.forEach(pattern => {
    report += `### ${pattern.name}\n`;
    report += `${pattern.description}\n`;
    report += `Examples:\n`;
    pattern.examples.forEach(ex => report += `- "${ex}"\n`);
    report += `\n`;
  });
  
  // Recommendations
  report += `## Recommendations for Better Categorization\n\n`;
  report += `1. **Add Foreign Language Category**: Many unmatched titles contain non-English characters\n`;
  report += `2. **Expand Music Category**: Include artist names, album titles, and music-specific terms\n`;
  report += `3. **Add Minimal Titles Category**: For very short titles that don't fit other patterns\n`;
  report += `4. **Create Compilation Category**: For "best of", "highlights", "moments" type content\n`;
  report += `5. **Add Event/Conference Category**: For keynotes, talks, presentations\n`;
  report += `6. **Expand Gaming Category**: Include more game titles and gaming terminology\n`;
  report += `7. **Add Meme/Internet Culture Category**: For trending formats and internet phenomena\n`;
  report += `8. **Create Product Showcase Category**: For unboxings, hauls, and product-focused content\n`;
  report += `9. **Add Storytelling Category**: For personal stories, case studies, and narratives\n`;
  report += `10. **Expand Location-Based Content**: For city guides, local content, and geographic-specific videos\n`;
  
  // Save report
  const outputPath = path.join(process.cwd(), 'exports', 'comprehensive-title-analysis.md');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report);
  
  console.log(`\nAnalysis complete! Report saved to: ${outputPath}`);
  console.log(`\nKey Findings:`);
  console.log(`- Matched: ${matchRate}% of titles`);
  console.log(`- Unmatched: ${(100 - matchRate).toFixed(2)}% of titles`);
  console.log(`- Most common category: ${sortedCategories[0][0]} (${(sortedCategories[0][1].count / totalVideos * 100).toFixed(2)}%)`);
  console.log(`- Discovered ${newPatterns.length} new pattern categories`);
}

// Run the analysis
processAllTitles().catch(console.error);
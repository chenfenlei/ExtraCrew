// ─────────────────────────────────────────────────────────────────────────────
// lib/data.js  — Static data, seed content, and constants
// ─────────────────────────────────────────────────────────────────────────────

export const CATS = [
  { id: "stem",   label: "STEM & Engineering", icon: "⚙",  color: "blue"   },
  { id: "premed", label: "Pre-Med & Health",   icon: "🩺", color: "red"    },
  { id: "biz",    label: "Business & Econ",    icon: "📈", color: "green"  },
  { id: "arts",   label: "Arts & Humanities",  icon: "🎨", color: "orange" },
  { id: "social", label: "Social Science",     icon: "🧠", color: "blue"   },
  { id: "law",    label: "Law & Policy",       icon: "⚖",  color: "red"    },
  { id: "env",    label: "Environment",        icon: "🌿", color: "green"  },
  { id: "sports", label: "Sports & Fitness",   icon: "🏃", color: "orange" },
];

export const CAT_TAG = {
  blue: "tag-blue", red: "tag-red", green: "tag-green", orange: "tag-orange",
};

export const SEED_GROUPS = [
  { id: "g1", name: "FRC Team 9871 — Circuit Breakers", category: "stem",   sub: "Robotics (FRC)",    location: "San Diego, CA", remote: false, members: ["u1"],       max: 10, desc: "Building our rookie FRC team for 2025-26. Looking for programmers, builders, and outreach leads.", tags: ["FRC","Java","CAD","Fundraising"], byId: "u1", byName: "Kenny L.",  ts: Date.now() - 864e5 * 3  },
  { id: "g2", name: "Virtual Pre-Med Study Circle",     category: "premed", sub: "MCAT Prep",          location: "Remote",        remote: true,  members: ["u2"],       max: 8,  desc: "Weekly virtual study sessions for aspiring med students — MCAT, biology, chemistry, and CARS.",  tags: ["MCAT","Biology","Chemistry"],    byId: "u2", byName: "Priya R.",  ts: Date.now() - 864e5      },
  { id: "g3", name: "YouthEcon Policy Lab",             category: "biz",    sub: "Econ Research",      location: "Remote",        remote: true,  members: ["u2"],       max: 6,  desc: "Researching economic policy and entering national competitions. Currently on housing affordability.", tags: ["Research","Writing","Policy"],  byId: "u2", byName: "Sofia M.",  ts: Date.now() - 864e5 * 5  },
  { id: "g4", name: "Literary Mag — The Margin",        category: "arts",   sub: "Creative Writing",   location: "Remote",        remote: true,  members: [],           max: 12, desc: "Online student literary magazine for poetry, fiction, and essays. Need editors and a web designer.", tags: ["Writing","Poetry","Editing"],   byId: "u1", byName: "Aisha T.",  ts: Date.now() - 864e5 * 2  },
  { id: "g5", name: "NeuroSpark Research Cohort",       category: "premed", sub: "Neuroscience",       location: "Remote",        remote: true,  members: [],           max: 5,  desc: "Students studying cognitive neuroscience, presenting at symposia, and collaborating on lit reviews.", tags: ["Neuroscience","Research"],      byId: "u2", byName: "Khalil B.", ts: Date.now() - 864e5 * 7  },
  { id: "g6", name: "Mock Trial — Apex Chapter",        category: "law",    sub: "Mock Trial",         location: "Los Angeles, CA",remote: false, members: [],           max: 14, desc: "Competitive mock trial team for AMTA tournaments. Attorneys and witnesses needed!",               tags: ["Public Speaking","Debate"],     byId: "u1", byName: "Marcus J.", ts: Date.now() - 864e5 * 10 },
];

// Mock user database — replace with Supabase/Clerk in production
export const MOCK_USERS = [
  { id: "u1", email: "kenny@extracrew.app",  password: "password123", name: "Kenny L.", role: "member", avatar: "KL", bio: "FRC robotics team lead, Java dev",           joinedGroups: ["g1"] },
  { id: "u2", email: "priya@extracrew.app",  password: "password123", name: "Priya R.", role: "member", avatar: "PR", bio: "Pre-med, MCAT prep organizer",               joinedGroups: ["g2"] },
  { id: "u3", email: "demo@extracrew.app",   password: "demo1234",    name: "You",      role: "member", avatar: "ME", bio: "New to ExtraCrew — building my profile!",    joinedGroups: []     },
];

export const SEED_MESSAGES = {
  g1: [
    { id: "m1", senderId: "u1", senderName: "Kenny L.", text: "Welcome to Circuit Breakers! This is our team's official chat 🤖", ts: Date.now() - 864e5 * 2 },
    { id: "m2", senderId: "u2", senderName: "Alex P.",  text: "Pumped to be here. I can help with drivetrain CAD and wiring",    ts: Date.now() - 864e5 * 2 + 6e4 },
    { id: "m3", senderId: "u1", senderName: "Kenny L.", text: "Perfect. CAD kickoff is Saturday — download Onshape if you haven't", ts: Date.now() - 864e5 + 3e4 },
  ],
  g2: [
    { id: "m4", senderId: "u2", senderName: "Priya R.", text: "First session Sunday 2pm EST. We'll cover Biology systems for Section 1", ts: Date.now() - 864e5 },
    { id: "m5", senderId: "u1", senderName: "James O.", text: "Should I bring Kaplan books or just Khan Academy?",                     ts: Date.now() - 864e5 + 9e4 },
    { id: "m6", senderId: "u2", senderName: "Priya R.", text: "Both! We're using them side by side",                                    ts: Date.now() - 864e5 + 15e4 },
  ],
};

export const AI_TOOLS = [
  { id: "supabase", name: "Supabase",        cat: "Database",  icon: "🗄", desc: "Open-source Postgres with real-time subscriptions. Replace localStorage with Supabase for groups, users, and messages.",             uses: ["Real-time group chat via channels","Store groups & members in Postgres","Auth with email or OAuth","Row Level Security for DM privacy"],          link: "https://supabase.com",         how: "Replace the localStorage helpers in lib/storage.js with Supabase client calls. Use supabase.channel() for live message delivery. Enable RLS." },
  { id: "clerk",    name: "Clerk",           cat: "Auth",      icon: "🔐", desc: "Drop-in user auth for Next.js. The AuthProvider is designed to be swapped for Clerk — same hooks, real JWT sessions.",                uses: ["Sign up / sign in pages","Real user profiles with avatars","Google, Discord, GitHub OAuth","Protect pages with middleware"],                   link: "https://clerk.com",            how: "Wrap layout.jsx in ClerkProvider. Replace AuthContext with useUser()/useClerk(). Update middleware.js to use clerkMiddleware()." },
  { id: "vercel",   name: "Vercel + Next.js",cat: "Deployment",icon: "▲",  desc: "Your app is already Next.js. /api/claude is a server-side route — the API key lives in Vercel's env vars, never the browser.",       uses: ["Free frontend hosting","API routes proxy Claude (key hidden)","Edge functions globally","Git push = deploy"],                                   link: "https://vercel.com",           how: "Push to GitHub. Import repo on vercel.com. Add ANTHROPIC_API_KEY in Project → Settings → Environment Variables. Done." },
  { id: "pusher",   name: "Pusher / Ably",   cat: "Real-time", icon: "📡", desc: "Managed WebSocket service for zero-latency chat. Add typing indicators, presence (who's online), and instant delivery.",             uses: ["Live chat with no polling","Typing indicators","Online presence badges","Delivery receipts"],                                                link: "https://pusher.com",           how: "Subscribe to group:{id} and dm:{uid1}:{uid2}. Trigger on send from the /api/messages route. Use Pusher Presence for online dots." },
  { id: "claude",   name: "Claude API",      cat: "AI",        icon: "🤖", desc: "Powers the Profile Advisor and AI Chat. All calls go through /api/claude — your API key is never exposed to the client.",             uses: ["Profile → school/activity matches","Conversational advisor","AI content moderation","Semantic activity suggestions"],                         link: "https://anthropic.com",        how: "Already wired. Set ANTHROPIC_API_KEY in Vercel env vars. To add streaming: use ReadableStream in the API route and EventSource in the client." },
  { id: "pinecone", name: "Pinecone",        cat: "AI",        icon: "🌲", desc: "Vector database for semantic matching. Embed group descriptions and interest profiles, then find closest matches — smarter than search.", uses: ["Semantic group recommendations","Match students by interest vector","'Groups you might like' feature","Similar user suggestions"],          link: "https://pinecone.io",          how: "Embed group.desc with text-embedding-3-small from /api/embed route. Upsert to Pinecone. On advisor submit, query top-k similar groups." },
  { id: "upstash",  name: "Upstash Redis",   cat: "Database",  icon: "⚡", desc: "Serverless Redis for edge rate limiting. Replaces the in-memory Map in lib/rateLimit.js so limits work across all Vercel instances.",  uses: ["Multi-region rate limiting","Persistent request counters","Edge-compatible","Free tier available"],                                         link: "https://upstash.com",          how: "npm install @upstash/ratelimit @upstash/redis. Swap checkRateLimit() in lib/rateLimit.js with Upstash's Ratelimit class. Add UPSTASH_REDIS_URL env var." },
];

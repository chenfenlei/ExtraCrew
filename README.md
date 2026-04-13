# ExtraCrew — Full Deployment Guide

A Next.js app for students to find extracurricular groups and get AI-powered college advice.

---

## How the API key stays secure

```
Browser → POST /api/claude (Vercel server) → Anthropic API
                   ↑
          ANTHROPIC_API_KEY lives only here.
          It is never sent to the browser.
          Users cannot find it in DevTools.
```

All AI calls from the frontend go to `/api/claude` — a server-side Next.js route function. That function reads `process.env.ANTHROPIC_API_KEY` (which only exists on Vercel's servers) and forwards the request to Anthropic. The key never touches the browser.

---

## Local development

### 1. Install dependencies
```bash
npm install
```

### 2. Create your local env file
```bash
cp .env.example .env.local
```

Open `.env.local` and paste your API key:
```
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY_HERE
```

> `.env.local` is in `.gitignore` — it will **never** be committed to Git.

### 3. Start the dev server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Demo login:** `demo@extracrew.app` / `demo1234`

---

## Deploy to Vercel (production)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/extracrew.git
git push -u origin main
```

### Step 2 — Import on Vercel
1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Import your GitHub repo
4. Click **Deploy** (Vercel auto-detects Next.js)

### Step 3 — Add your API key
1. In Vercel, open your project
2. Go to **Settings → Environment Variables**
3. Add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-api03-YOUR_KEY_HERE`
   - **Environment:** Production, Preview, Development ✓
4. Click **Save**
5. Go to **Deployments** → click the three dots → **Redeploy**

Your site is now live. The API key exists only in Vercel's secure vault.

---

## Security features built in

| Layer | What's protected |
|---|---|
| **API route** | Key read from `process.env`, never returned to browser |
| **Rate limiting** | 20 Claude requests/min per IP (`lib/rateLimit.js`) |
| **Input sanitization** | All user text stripped of `<>` and control chars before reaching AI |
| **Content policy** | Blocked keywords rejected server-side before forwarding |
| **HTTP security headers** | X-Frame-Options, CSP, HSTS, X-Content-Type-Options (in `next.config.js`) |
| **Form validation** | Client + server-side checks with clear error messages |
| **Session tokens** | Expiring tokens stored in `sessionStorage`, never `localStorage` |
| **Context window management** | Chat history trimmed to last 20 messages before each API call |

---

## Upgrading to production backends

The app is designed so each layer can be swapped independently:

### Auth → Clerk
```bash
npm install @clerk/nextjs
```
Replace `AuthProvider` in `app/page.jsx` with `<ClerkProvider>`. The rest of the app already uses `user.id` and `user.name` — no other changes needed.

### Database → Supabase
```bash
npm install @supabase/supabase-js
```
Replace the `DB.load/save` helpers in `app/page.jsx` with Supabase client calls. Add Row Level Security on the `messages` table so users can only read their own DMs.

### Real-time chat → Pusher
```bash
npm install pusher pusher-js
```
Add a `POST /api/messages` route that saves to Supabase and triggers a Pusher event. Subscribe in the Chat component with `pusher.subscribe('group-' + groupId)`.

### Rate limiting → Upstash Redis (multi-region)
```bash
npm install @upstash/ratelimit @upstash/redis
```
Replace `checkRateLimit()` in `lib/rateLimit.js` with the Upstash `Ratelimit` class. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Vercel env vars.

---

## Project structure

```
extracrew/
├── app/
│   ├── api/
│   │   └── claude/
│   │       └── route.js      ← Secure Claude proxy (server-side)
│   ├── layout.jsx            ← Root layout + metadata
│   ├── page.jsx              ← Full app (client component)
│   └── globals.css           ← All styles
├── lib/
│   ├── api.js                ← Frontend: calls /api/claude
│   ├── data.js               ← Seed data + constants
│   ├── rateLimit.js          ← Server-side IP rate limiter
│   └── security.js           ← Sanitize, validate, content check
├── .env.example              ← Copy to .env.local
├── .gitignore                ← .env.local excluded
├── next.config.js            ← Security headers
├── vercel.json               ← Vercel config
└── README.md
```

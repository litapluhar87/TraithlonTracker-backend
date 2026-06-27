# Triathlon Tracker — Backend Setup

## Prerequisites
- Node.js 18+
- A Strava account (for the API app)
- A Supabase account (free)

---

## Step 1 — Strava API App

1. Go to https://www.strava.com/settings/api
2. Create an application:
   - Name: Triathlon Tracker
   - Category: Training
   - Authorization Callback Domain: `localhost`
   - Website: `http://localhost:3000`
3. Note your **Client ID** and **Client Secret**

---

## Step 2 — Supabase Setup

1. Go to https://supabase.com and create a free account
2. Create a new project (name it "triathlon-tracker")
3. Go to SQL Editor → paste the entire contents of `supabase_schema.sql` → Run
4. Go to Settings → API → copy:
   - **Project URL** (looks like https://xxxx.supabase.co)
   - **service_role** key (under Project API keys)

---

## Step 3 — Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `STRAVA_CLIENT_ID` — from Step 1
- `STRAVA_CLIENT_SECRET` — from Step 1
- `SUPABASE_URL` — from Step 2
- `SUPABASE_SERVICE_KEY` — from Step 2
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — any random string e.g. `triathlon2024secret`

---

## Step 4 — Install & Run

```bash
npm install
npm run dev
```

You should see:
```
🚀 Triathlon Tracker backend running on http://localhost:3001
   Strava OAuth: http://localhost:3001/auth/strava
   Webhook:      http://localhost:3001/webhook/strava
```

---

## Step 5 — Test the OAuth Flow

1. Open your browser and go to: `http://localhost:3001/auth/strava`
2. You'll be redirected to Strava → click Authorize
3. Strava sends you back to `http://localhost:5173?auth=success&athlete_id=XXXXXX`
4. Note the `athlete_id` in the URL — that's your friend's Strava ID
5. Check Supabase → Table Editor → athletes — you should see a new row

---

## Step 6 — Test Activity Fetch

Once OAuth works, open in browser:
```
http://localhost:3001/api/athlete/XXXXXX
```
(replace XXXXXX with her Strava athlete ID)

You should see her recent swim/bike/run activities as JSON.

---

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/auth/strava` | Start Strava login |
| GET | `/auth/strava/callback` | OAuth callback (Strava calls this) |
| GET | `/api/athlete/:stravaId` | Fetch athlete + sync recent activities |
| GET | `/api/activities/:stravaId` | Get stored activities (with `?weeks=12`) |
| GET | `/webhook/strava` | Webhook verification (Strava calls this) |
| POST | `/webhook/strava` | Receive new activity events from Strava |

---

## File Structure

```
backend/
├── index.js              ← Main server (all routes)
├── supabase_schema.sql   ← Run once in Supabase SQL editor
├── .env.example          ← Copy to .env and fill in
├── .env                  ← Your secrets (never commit this)
└── package.json
```

---

## Next Step

Once Step 5 works, the frontend (React) connects to this backend.
The frontend is in the `/frontend` folder — setup instructions there.

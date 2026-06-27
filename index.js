import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

import fs from 'fs';

const localEnvPath = "C:\\Rahul\\claude-projects\\FitnessApp\\Secrets\\triathlon-tracker.env";
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
} else {
  dotenv.config(); // Render: env vars already injected via dashboard, this is a harmless no-op
}

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://litapluhar87.github.io",
  ],
}));
app.use(express.json());

// ─── Supabase client ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Strava constants ──────────────────────────────────────────────────────────
const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI  = process.env.STRAVA_REDIRECT_URI;
const WEBHOOK_VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

// ─── STEP 1: Redirect user to Strava login ────────────────────────────────────
// Frontend hits this URL → user is sent to Strava to approve access
app.get("/auth/strava", (req, res) => {
  const scope = "activity:read_all,profile:read_all";
  const stravaAuthUrl =
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${STRAVA_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${scope}`;

  res.redirect(stravaAuthUrl);
});

// ─── STEP 2: Strava redirects back here with a code ───────────────────────────
// Exchange the code for an access token, save athlete to Supabase
app.get("/auth/strava/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("http://localhost:5173?auth=denied");
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.athlete) {
      throw new Error("No athlete data returned from Strava");
    }

    const athlete = tokenData.athlete;

    // Save athlete + tokens to Supabase
    const { error: dbError } = await supabase.from("athletes").upsert({
      strava_id:     athlete.id,
      firstname:     athlete.firstname,
      lastname:      athlete.lastname,
      profile_pic:   athlete.profile,
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires: tokenData.expires_at,
      updated_at:    new Date().toISOString(),
    }, { onConflict: "strava_id" });

    if (dbError) throw dbError;

    // Redirect to frontend with athlete's Strava ID so it knows who logged in
    res.redirect(`http://localhost:5173?auth=success&athlete_id=${athlete.id}`);

  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect("http://localhost:5173?auth=error");
  }
});

// ─── STEP 3: Get athlete profile + recent activities ──────────────────────────
app.get("/api/athlete/:stravaId", async (req, res) => {
  try {
    const { stravaId } = req.params;

    const { data: athlete, error } = await supabase
      .from("athletes")
      .select("*")
      .eq("strava_id", stravaId)
      .single();

    if (error || !athlete) {
      return res.status(404).json({ error: "Athlete not found" });
    }

    // Refresh token if expired
    const token = await getValidToken(athlete);

    // Fetch last 30 activities from Strava
    const activitiesRes = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=30",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const activities = await activitiesRes.json();

    // Filter to swim, ride, run only and save to Supabase
    const triActivities = activities
      .filter(a => ["Swim", "Ride", "Run", "VirtualRide"].includes(a.type))
      .map(a => ({
        strava_activity_id: a.id,
        athlete_strava_id:  athlete.strava_id,
        type:               normaliseType(a.type),
        name:               a.name,
        distance_m:         a.distance,
        duration_s:         a.moving_time,
        elevation_m:        a.total_elevation_gain,
        avg_heart_rate:     a.average_heartrate || null,
        avg_speed_ms:       a.average_speed,
        start_date:         a.start_date,
        strava_data:        a, // store full raw data too
      }));

    // Upsert all activities (won't duplicate)
    if (triActivities.length > 0) {
      await supabase
        .from("activities")
        .upsert(triActivities, { onConflict: "strava_activity_id" });
    }

    // Return athlete + activities to frontend
    res.json({
      athlete: {
        id:          athlete.strava_id,
        name:        `${athlete.firstname} ${athlete.lastname}`,
        profile_pic: athlete.profile_pic,
      },
      activities: triActivities,
    });

  } catch (err) {
    console.error("Athlete fetch error:", err);
    res.status(500).json({ error: "Failed to fetch athlete data" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MANUAL ENTRY ROUTES (user_id based — no Strava required)
// ════════════════════════════════════════════════════════════════════════════

// ─── Get or create athlete by user_id ─────────────────────────────────────────
app.get("/api/manual/athlete/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    let { data: athlete, error } = await supabase
      .from("athletes")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    // Auto-create on first login
    if (!athlete) {
      const { data: created, error: createErr } = await supabase
        .from("athletes")
        .insert({ user_id: userId })
        .select()
        .single();

      if (createErr) throw createErr;
      athlete = created;
    }

    res.json({ athlete });
  } catch (err) {
    console.error("Manual athlete fetch error:", err);
    res.status(500).json({ error: "Failed to fetch athlete" });
  }
});

// ─── Log a new manual activity ────────────────────────────────────────────────
app.post("/api/activities", async (req, res) => {
  try {
    const {
      user_id, type, name, distance_m, duration_s,
      elevation_m, start_date, notes, feel_rating,
    } = req.body;

    if (!user_id || !type || !start_date) {
      return res.status(400).json({ error: "user_id, type and start_date are required" });
    }

    const { data, error } = await supabase
      .from("activities")
      .insert({
        user_id,
        type,
        name:        name || type,
        distance_m:  distance_m || 0,
        duration_s:  duration_s || 0,
        elevation_m: elevation_m || null,
        start_date,
        data_source: "manual",
        strava_data: notes || feel_rating ? { notes, feel_rating } : null,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ activity: data });
  } catch (err) {
    console.error("Activity insert error:", err);
    res.status(500).json({ error: "Failed to save activity" });
  }
});

// ─── Delete a manual activity ──────────────────────────────────────────────────
app.delete("/api/activities/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("Activity delete error:", err);
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

// ─── Update (edit) a manual activity ──────────────────────────────────────────
app.put("/api/activities/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      type, name, distance_m, duration_s,
      elevation_m, start_date, notes, feel_rating,
    } = req.body;

    const updateFields = {};
    if (type !== undefined)        updateFields.type = type;
    if (name !== undefined)        updateFields.name = name;
    if (distance_m !== undefined)  updateFields.distance_m = distance_m;
    if (duration_s !== undefined)  updateFields.duration_s = duration_s;
    if (elevation_m !== undefined) updateFields.elevation_m = elevation_m;
    if (start_date !== undefined)  updateFields.start_date = start_date;
    if (notes !== undefined || feel_rating !== undefined) {
      updateFields.strava_data = { notes, feel_rating };
    }

    const { data, error } = await supabase
      .from("activities")
      .update(updateFields)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json({ activity: data });
  } catch (err) {
    console.error("Activity update error:", err);
    res.status(500).json({ error: "Failed to update activity" });
  }
});


// ─── Get all activities for a user_id (manual or Strava-linked) ──────────────
app.get("/api/manual/activities/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: activities, error } = await supabase
      .from("activities")
      .select("*")
      .eq("user_id", userId)
      .order("start_date", { ascending: false });

    if (error) throw error;

    res.json({ activities });
  } catch (err) {
    console.error("Manual activities fetch error:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});


// Strava sends a GET to verify your webhook endpoint during setup
app.get("/webhook/strava", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("✅ Strava webhook verified");
    res.json({ "hub.challenge": challenge });
  } else {
    res.status(403).json({ error: "Verification failed" });
  }
});

// Strava sends a POST when a new activity is created
app.post("/webhook/strava", async (req, res) => {
  const event = req.body;
  res.status(200).send("EVENT_RECEIVED"); // Strava needs a fast 200 response

  // Only process new activity creations
  if (event.object_type !== "activity" || event.aspect_type !== "create") return;

  try {
    const athleteStravaId = event.owner_id;
    const activityId      = event.object_id;

    // Get athlete's token from Supabase
    const { data: athlete } = await supabase
      .from("athletes")
      .select("*")
      .eq("strava_id", athleteStravaId)
      .single();

    if (!athlete) return;

    const token = await getValidToken(athlete);

    // Fetch the full activity details
    const actRes = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const activity = await actRes.json();

    if (!["Swim", "Ride", "Run", "VirtualRide"].includes(activity.type)) return;

    // Save to Supabase
    await supabase.from("activities").upsert({
      strava_activity_id: activity.id,
      athlete_strava_id:  athleteStravaId,
      type:               normaliseType(activity.type),
      name:               activity.name,
      distance_m:         activity.distance,
      duration_s:         activity.moving_time,
      elevation_m:        activity.total_elevation_gain,
      avg_heart_rate:     activity.average_heartrate || null,
      avg_speed_ms:       activity.average_speed,
      start_date:         activity.start_date,
      strava_data:        activity,
    }, { onConflict: "strava_activity_id" });

    console.log(`✅ New ${activity.type} activity saved for athlete ${athleteStravaId}`);

  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});

// ─── STEP 5: Get stored activities for dashboard ──────────────────────────────
app.get("/api/activities/:stravaId", async (req, res) => {
  try {
    const { stravaId } = req.params;
    const { weeks = 12 } = req.query;

    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    const { data: activities, error } = await supabase
      .from("activities")
      .select("*")
      .eq("athlete_strava_id", stravaId)
      .gte("start_date", since.toISOString())
      .order("start_date", { ascending: false });

    if (error) throw error;

    res.json({ activities });

  } catch (err) {
    console.error("Activities fetch error:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Normalise Strava activity types to swim/bike/run
function normaliseType(stravaType) {
  if (stravaType === "Swim")                      return "swim";
  if (stravaType === "Ride" || stravaType === "VirtualRide") return "bike";
  if (stravaType === "Run")                       return "run";
  return "other";
}

// Refresh Strava access token if expired
async function getValidToken(athlete) {
  const now = Math.floor(Date.now() / 1000);
  if (athlete.token_expires > now) return athlete.access_token;

  // Token expired — refresh it
  const refreshRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type:    "refresh_token",
      refresh_token: athlete.refresh_token,
    }),
  });

  const refreshData = await refreshRes.json();

  // Update tokens in Supabase
  await supabase.from("athletes").update({
    access_token:  refreshData.access_token,
    refresh_token: refreshData.refresh_token,
    token_expires: refreshData.expires_at,
  }).eq("strava_id", athlete.strava_id);

  return refreshData.access_token;
}

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Triathlon Tracker backend running on http://localhost:${PORT}`);
  console.log(`   Strava OAuth: http://localhost:${PORT}/auth/strava`);
  console.log(`   Webhook:      http://localhost:${PORT}/webhook/strava`);
});

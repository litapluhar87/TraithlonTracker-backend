-- ============================================================
-- Triathlon Tracker — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Athletes table
-- One row per athlete (your friend, and future users)
create table if not exists athletes (
  id              bigserial primary key,
  strava_id       bigint unique not null,
  firstname       text,
  lastname        text,
  profile_pic     text,
  access_token    text,
  refresh_token   text,
  token_expires   bigint,        -- Unix timestamp
  race_date       date,          -- e.g. 2025-10-15 (Olympic triathlon date)
  plan_start_date date,          -- Week 1 start date
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Activities table
-- One row per swim/bike/run session, auto-populated from Strava
create table if not exists activities (
  id                  bigserial primary key,
  strava_activity_id  bigint unique not null,
  athlete_strava_id   bigint references athletes(strava_id),
  type                text not null check (type in ('swim', 'bike', 'run', 'other')),
  name                text,
  distance_m          float,      -- metres
  duration_s          int,        -- seconds
  elevation_m         float,      -- metres gained
  avg_heart_rate      float,
  avg_speed_ms        float,      -- metres per second
  start_date          timestamptz,
  strava_data         jsonb,      -- full raw Strava response, useful later
  created_at          timestamptz default now()
);

-- Index for fast athlete+date queries (used by dashboard)
create index if not exists activities_athlete_date
  on activities(athlete_strava_id, start_date desc);

-- ============================================================
-- Helper views (used by the frontend API)
-- ============================================================

-- Weekly summary per discipline
-- Returns total distance and duration per week per activity type
create or replace view weekly_summary as
select
  athlete_strava_id,
  type,
  date_trunc('week', start_date) as week_start,
  count(*)                        as session_count,
  round(sum(distance_m)::numeric, 0)   as total_distance_m,
  round(sum(duration_s)::numeric, 0)   as total_duration_s
from activities
where type != 'other'
group by athlete_strava_id, type, date_trunc('week', start_date)
order by week_start desc;

-- ============================================================
-- Sample: manually set your friend's plan dates (run after insert)
-- Replace the strava_id with her actual Strava athlete ID
-- ============================================================
-- update athletes
-- set
--   race_date       = '2025-10-15',
--   plan_start_date = '2025-07-01'
-- where strava_id = 123456789;

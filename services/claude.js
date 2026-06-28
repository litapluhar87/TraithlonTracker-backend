import fetch from "node-fetch";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // cheapest current model, plenty for short summaries

export async function callClaude(prompt) {
  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "";
}

const TONE_INSTRUCTION =
  "Tone: balanced and constructive — be honest about gaps from target, but " +
  "frame feedback supportively, like a good coach who tells the truth without " +
  "being harsh. Keep it tight, 3-4 sentences max, no bullet points, no headers, " +
  "no preamble like 'Here is a summary' — just the summary text directly.";

export function buildSessionPrompt(activity) {
  const { type, distance_m, duration_s, extrapolated_s, onTrack } = activity;
  return `
A triathlete training for an Olympic-distance triathlon (4 Oct 2026) just logged
a ${type} session: ${distance_m}m in ${Math.round(duration_s / 60)} minutes.
Extrapolated race-distance time: ${Math.round(extrapolated_s / 60)} minutes.
Status vs target: ${onTrack ? "on track" : "behind target"}.

Give a short interpretation of this session from a triathlon-training-goal
perspective — what it means for race readiness, anything notable (good or
needing work). ${TONE_INSTRUCTION}
`.trim();
}

export function buildCumulativePrompt(scope, stats) {
  const { sessionCount, avgPace, bestPace, onTrackPct, targetLabel } = stats;
  return `
A triathlete training for an Olympic-distance triathlon (4 Oct 2026) has logged
${sessionCount} ${scope} sessions so far. Average pace/speed: ${avgPace}.
Best so far: ${bestPace}. ${onTrackPct}% of sessions were on or ahead of the
race target (${targetLabel}).

Give a short cumulative summary of their ${scope} progress toward race readiness.
${TONE_INSTRUCTION}
`.trim();
}

export function buildOverallPrompt(allStats) {
  const { totalSessions, daysToRace, disciplineSummaries } = allStats;
  return `
A triathlete is ${daysToRace} days out from an Olympic-distance triathlon.
They've logged ${totalSessions} total training sessions across swim, bike, and run.

Per-discipline status:
${disciplineSummaries}

Give a short overall summary of where they stand across all three disciplines,
and what deserves the most attention with the remaining time. ${TONE_INSTRUCTION}
`.trim();
}

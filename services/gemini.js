import fetch from "node-fetch";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

export async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.6 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

const TONE_INSTRUCTION =
  "Tone: balanced and constructive — be honest about gaps from target, but " +
  "frame feedback supportively, like a good coach who tells the truth without " +
  "being harsh. Keep it tight, 3-4 sentences max, no bullet points, no headers.";

export function buildSessionPrompt(activity, raceConfig) {
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
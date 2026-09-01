import { SUPABASE_URL, SUPABASE_KEY } from "./_lib.js";

export const config = { runtime: "edge" };

// Supabase pausiert Projekte auf dem Free-Tier automatisch nach 7 Tagen ohne
// Aktivität. Dieser Cron schickt täglich eine minimale Leseanfrage, damit das
// Projekt immer als aktiv zählt — deutlich unter der 7-Tage-Schwelle.
export default async function handler() {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id&limit=1`, { headers });
  return new Response(JSON.stringify({ ok: res.ok, status: res.status }), {
    status: res.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
}

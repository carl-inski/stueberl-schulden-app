// Gemeinsame Datenlogik für die Serverless-Funktionen (og-Bild, Telegram-Report).
// Dateiname mit "_" wird von Vercel nicht als eigene Route veröffentlicht.

export const SUPABASE_URL = "https://netvekbtbfarqsjsqrun.supabase.co";
export const SUPABASE_KEY = "sb_publishable_r2dkvTHLX7YYX3ICyO-uGw_PSdrA58E";

export const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

// Holt alle Personen mit offenen Schulden, absteigend sortiert.
// scope="pfarrjugend" beschränkt auf Pfarrjugend-Mitglieder (ohne Alumni/Extern).
export async function fetchDebtors(scope) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [usersRes, txRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/users?select=id,name,category`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/transactions?select=user_id,amount`, { headers }),
  ]);
  if (!usersRes.ok || !txRes.ok) throw new Error("Supabase-Anfrage fehlgeschlagen");

  const users = await usersRes.json();
  const txs = await txRes.json();
  const byId = new Map(users.map((u) => [u.id, { name: u.name, category: u.category, bal: 0 }]));
  for (const t of txs) {
    const u = byId.get(t.user_id);
    if (u) u.bal += Number(t.amount);
  }

  let list = [...byId.values()].filter((u) => u.bal > 0.004);
  if (scope === "pfarrjugend") list = list.filter((u) => u.category === "Pfarrjugend");
  list.sort((a, b) => b.bal - a.bal || a.name.localeCompare(b.name, "de"));

  const total = list.reduce((sum, u) => sum + u.bal, 0);
  return { total, debtors: list, count: list.length };
}

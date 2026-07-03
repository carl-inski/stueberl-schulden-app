import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://netvekbtbfarqsjsqrun.supabase.co";
const SUPABASE_KEY = "sb_publishable_r2dkvTHLX7YYX3ICyO-uGw_PSdrA58E";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

async function fetchTotals() {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [usersRes, txRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/users?select=id`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/transactions?select=user_id,amount`, { headers }),
  ]);
  if (!usersRes.ok || !txRes.ok) throw new Error("Supabase-Anfrage fehlgeschlagen");

  const users = await usersRes.json();
  const txs = await txRes.json();
  const balances = new Map(users.map((u) => [u.id, 0]));
  for (const t of txs) {
    balances.set(t.user_id, (balances.get(t.user_id) || 0) + Number(t.amount));
  }

  let total = 0;
  let debtors = 0;
  for (const bal of balances.values()) {
    if (bal > 0.004) {
      total += bal;
      debtors += 1;
    }
  }
  return { total, debtors };
}

export default async function handler() {
  let amountLabel = "—";
  let subLabel = "Schuldenübersicht fürs Stüberl";

  try {
    const { total, debtors } = await fetchTotals();
    amountLabel = eur.format(total);
    subLabel =
      debtors === 0
        ? "Alle Schulden beglichen"
        : `${debtors} ${debtors === 1 ? "Person hat" : "Personen haben"} offene Schulden`;
  } catch {
    // Fällt auf einen neutralen Text zurück, statt falsche Zahlen zu zeigen.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          backgroundImage:
            "linear-gradient(135deg, #ecdcf7 0%, #f7ecd9 55%, #fbe1ad 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "20px",
              background: "rgba(255,255,255,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "36px",
              fontWeight: 700,
              color: "#55416b",
            }}
          >
            €
          </div>
          <div style={{ fontSize: "34px", fontWeight: 600, color: "rgba(58,42,78,0.75)" }}>
            SJB Stüberl
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: "30px",
              fontWeight: 600,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "rgba(58,42,78,0.65)",
            }}
          >
            Offene Schulden
          </div>
          <div
            style={{
              fontSize: "128px",
              fontWeight: 700,
              color: "#33254a",
              letterSpacing: "-3px",
              lineHeight: 1.05,
            }}
          >
            {amountLabel}
          </div>
          <div style={{ fontSize: "36px", fontWeight: 500, color: "rgba(58,42,78,0.65)" }}>
            {subLabel}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
      },
    }
  );
}

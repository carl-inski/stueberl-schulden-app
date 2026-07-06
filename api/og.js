import { ImageResponse } from "@vercel/og";
import { fetchDebtors, eur } from "./_lib.js";

export const config = { runtime: "edge" };

// Baut ein Satori-Element ohne React/JSX — @vercel/og braucht nur diese Form
// ({ type, props: { style, children } }), kein React zur Laufzeit nötig.
function h(type, style, children) {
  return { type, props: { style, children } };
}

export default async function handler(request) {
  // ?scope=pfarrjugend zählt nur Pfarrjugend (für den Telegram-Report);
  // ohne Parameter bleibt es die App-Linkvorschau über alle Kategorien.
  const scope = new URL(request.url).searchParams.get("scope") || undefined;

  let amountLabel = "—";
  let subLabel = "Schuldenübersicht fürs Stüberl";

  try {
    const { total, count } = await fetchDebtors(scope);
    amountLabel = eur.format(total);
    subLabel =
      count === 0
        ? "Alle Schulden beglichen"
        : `${count} ${count === 1 ? "Person hat" : "Personen haben"} offene Schulden`;
  } catch {
    // Fällt auf einen neutralen Text zurück, statt falsche Zahlen zu zeigen.
  }

  const badge = h(
    "div",
    {
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
    },
    "€"
  );

  const brand = h(
    "div",
    { fontSize: "34px", fontWeight: 600, color: "rgba(58,42,78,0.75)" },
    "SJB Stüberl"
  );

  const topRow = h("div", { display: "flex", alignItems: "center", gap: "20px" }, [badge, brand]);

  const label = h(
    "div",
    {
      fontSize: "30px",
      fontWeight: 600,
      letterSpacing: "3px",
      textTransform: "uppercase",
      color: "rgba(58,42,78,0.65)",
    },
    "Offene Schulden"
  );

  const amount = h(
    "div",
    {
      fontSize: "128px",
      fontWeight: 700,
      color: "#33254a",
      letterSpacing: "-3px",
      lineHeight: 1.05,
    },
    amountLabel
  );

  const sub = h(
    "div",
    { fontSize: "36px", fontWeight: 500, color: "rgba(58,42,78,0.65)" },
    subLabel
  );

  const bottomBlock = h("div", { display: "flex", flexDirection: "column" }, [label, amount, sub]);

  const root = h(
    "div",
    {
      width: "1200px",
      height: "630px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "72px",
      backgroundImage: "linear-gradient(135deg, #ecdcf7 0%, #f7ecd9 55%, #fbe1ad 100%)",
      fontFamily: "system-ui, sans-serif",
    },
    [topRow, bottomBlock]
  );

  return new ImageResponse(root, {
    width: 1200,
    height: 630,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
    },
  });
}

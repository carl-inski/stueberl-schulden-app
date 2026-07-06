import { fetchDebtors, eur } from "./_lib.js";

export const config = { runtime: "edge" };

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

const MAX_LINES = 25; // Telegram-Foto-Caption ist auf 1024 Zeichen begrenzt

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCaption(total, debtors) {
  const now = new Date();
  const lines = [];
  lines.push("<b>SJB Stüberl – Schuldenstand</b>");
  lines.push(monthFmt.format(now));
  lines.push("");

  if (debtors.length === 0) {
    lines.push("Aktuell hat niemand in der Pfarrjugend offene Schulden. 🎉");
    lines.push("");
  } else {
    const shown = debtors.slice(0, MAX_LINES);
    shown.forEach((d, i) => {
      lines.push(`${i + 1}. ${escapeHtml(d.name)} — ${eur.format(d.bal)}`);
    });
    if (debtors.length > shown.length) {
      lines.push(`… und ${debtors.length - shown.length} weitere`);
    }
    lines.push("");
    lines.push(`<b>Gesamt: ${eur.format(total)}</b>`);
  }
  lines.push(`Stand: ${dateFmt.format(now)}`);
  return lines.join("\n");
}

// Zugriffsschutz: Vercel-Cron sendet automatisch "Authorization: Bearer <CRON_SECRET>",
// wenn die Env-Var CRON_SECRET gesetzt ist. Für manuelle Tests ist auch ?key=<secret> erlaubt.
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // kein Secret gesetzt → offen (nur bis zur Einrichtung)
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const key = new URL(request.url).searchParams.get("key");
  return key === secret;
}

export default async function handler(request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return new Response(
      JSON.stringify({ error: "TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlt" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let total = 0;
  let debtors = [];
  try {
    ({ total, debtors } = await fetchDebtors("pfarrjugend"));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Datenabruf fehlgeschlagen: " + String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const caption = buildCaption(total, debtors);
  const origin = new URL(request.url).origin;
  const imageUrl = `${origin}/api/og?scope=pfarrjugend&t=${Date.now()}`;

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption,
      parse_mode: "HTML",
    }),
  });
  const tgJson = await tgRes.json().catch(() => ({}));

  if (!tgJson.ok) {
    return new Response(JSON.stringify({ sent: false, telegram: tgJson }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ sent: true, count: debtors.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

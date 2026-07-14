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

// ---------- Telegram-Report ----------

export const APP_URL = "https://stueberl.vercel.app";

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

const MAX_LINES = 25; // Telegram-Foto-Caption ist auf 1024 Zeichen begrenzt

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildCaption(total, debtors) {
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
  lines.push("");
  lines.push(`<a href="${APP_URL}">${APP_URL.replace("https://", "")}</a>`);
  return lines.join("\n");
}

// ---------- Alten Report-Nachricht pro Chat nachhalten (für Auto-Löschen) ----------

async function getLastMessageId(chatId) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_report_messages?chat_id=eq.${chatId}&select=message_id`,
    { headers }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.message_id ?? null;
}

async function setLastMessageId(chatId, messageId) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_report_messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

// Holt den Pfarrjugend-Schuldenstand und postet ihn (Bild + Caption) in einen Chat.
// Löscht zuvor den vorherigen Report-Post im selben Chat, damit dort immer
// nur der aktuelle Stand steht statt sich alte Stände anzusammeln.
export async function sendReport({ token, chatId, origin }) {
  const { total, debtors } = await fetchDebtors("pfarrjugend");
  const caption = buildCaption(total, debtors);
  const imageUrl = `${origin}/api/og?scope=pfarrjugend&t=${Date.now()}`;

  const previousId = await getLastMessageId(chatId);
  if (previousId) {
    // Best effort: alte Nachricht kann bereits gelöscht/zu alt sein — dann
    // einfach ignorieren und trotzdem den neuen Stand posten.
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: previousId }),
    }).catch(() => {});
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: imageUrl, caption, parse_mode: "HTML" }),
  });
  const json = await res.json().catch(() => ({}));

  if (json.ok && json.result && json.result.message_id) {
    await setLastMessageId(chatId, json.result.message_id);
  }

  return { ok: !!json.ok, telegram: json, count: debtors.length };
}

export async function sendMessage({ token, chatId, text }) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

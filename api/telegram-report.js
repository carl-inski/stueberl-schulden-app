import { sendReport } from "./_lib.js";

export const config = { runtime: "edge" };

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

  try {
    const result = await sendReport({ token, chatId });
    return new Response(JSON.stringify({ sent: result.ok, count: result.count, telegram: result.ok ? undefined : result.telegram }), {
      status: result.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

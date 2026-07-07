import { sendReport, sendMessage } from "./_lib.js";

export const config = { runtime: "edge" };

// Commands, die den Schuldenstand anfordern (auch als /schulden@botname in Gruppen)
const REPORT_COMMANDS = ["/schulden", "/stand", "/uebersicht", "/übersicht"];
const HELP_TEXT =
  "Schreib /schulden, um den aktuellen Stüberl-Schuldenstand der Pfarrjugend abzurufen. " +
  "Automatisch kommt er außerdem am 1. jedes Monats.";

export default async function handler(request) {
  // Telegram schickt Updates per POST. Alles andere freundlich ignorieren.
  if (request.method !== "POST") return new Response("OK");

  // Verifizierung: Telegram sendet den beim setWebhook gesetzten Secret-Token mit.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response("OK");

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("OK");
  }

  const msg = update.message || update.channel_post;
  const text = msg && typeof msg.text === "string" ? msg.text.trim() : "";
  const chatId = msg && msg.chat && msg.chat.id;
  if (!text || chatId == null) return new Response("OK");

  // "/schulden@botname args" → "/schulden"
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  const origin = new URL(request.url).origin;

  try {
    if (REPORT_COMMANDS.includes(cmd)) {
      await sendReport({ token, chatId, origin });
    } else if (cmd === "/start" || cmd === "/help") {
      await sendMessage({ token, chatId, text: HELP_TEXT });
    }
  } catch {
    await sendMessage({ token, chatId, text: "Konnte den Schuldenstand gerade nicht laden — bitte später nochmal." }).catch(() => {});
  }

  // Telegram erwartet eine schnelle 200-Antwort.
  return new Response("OK", { status: 200 });
}

/* ============================================================
   Stüberl-Schulden — App-Logik
   Datenhaltung: Supabase (Projekt "stueberl-schulden")
   ============================================================ */

const SUPABASE_URL = "https://netvekbtbfarqsjsqrun.supabase.co";
const SUPABASE_KEY = "sb_publishable_r2dkvTHLX7YYX3ICyO-uGw_PSdrA58E";

if (!window.supabase) {
  document.getElementById("sync-label").textContent = "Fehler";
  throw new Error("supabase-js wurde nicht geladen (js/vendor/supabase.min.js fehlt?)");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TAGS = ["Pfarrjugend", "Alumni", "Extern"];

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
const monthYearFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

// ---------- Zustand ----------

const state = {
  users: [],            // [{id, name, category, created_at}]
  transactions: [],     // [{id, user_id, amount, description, created_at, event_id, events: {...} | null}]
  view: "overview",     // "overview" | "entry" | "persons" | "log"
  mode: "add",          // "add" | "pay"
  selection: new Map(), // Event-Eintrag: personId -> Betrag
  payPersonId: null,
  witnessId: null,
  newPersonTag: "Pfarrjugend",
  sheet: null,          // { type: "detail" | "edit" | "event", id, draftTag? } | null
  logSearch: "",        // Freitext-Filter im Aktivitätenlog
};

const $ = (sel) => document.querySelector(sel);

// ---------- Daten laden ----------

async function loadData() {
  const [usersRes, txRes] = await Promise.all([
    db.from("users").select("*"),
    db.from("transactions")
      .select("*, events(name, entered_by_user_id)")
      .order("created_at", { ascending: false }),
  ]);
  if (usersRes.error || txRes.error) {
    throw usersRes.error || txRes.error;
  }
  state.users = usersRes.data.sort((a, b) => a.name.localeCompare(b.name, "de"));
  state.transactions = txRes.data;
  renderAll();
}

function getUser(id) {
  return state.users.find((u) => u.id === id) || null;
}

function userName(id) {
  const u = getUser(id);
  return u ? u.name : "Unbekannt";
}

function balances() {
  const map = new Map(state.users.map((u) => [u.id, 0]));
  for (const t of state.transactions) {
    map.set(t.user_id, (map.get(t.user_id) || 0) + Number(t.amount));
  }
  return map;
}

// ---------- "Abend"-Gruppierung (für Event-Vorschlag/Zusammenführung) ----------
// Ein Abend zählt intern bis 6 Uhr morgens (falls mal länger gefeiert wird) —
// nur für diese Gruppierungslogik, nicht für die Datumsanzeige im Log.

function eveningKey(date) {
  const d = new Date(date);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function normalizeTitle(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// Toleriert Tippfehler/Varianten beim Vergleich zweier Event-Titel: exakte
// Übereinstimmung, einer als Teilstring des anderen (z. B. "Stüberl" in
// "Stüberl-Runde") oder eine kleine Editierdistanz (z. B. "Fussball" /
// "Fußball", vertippte Buchstaben).
function titlesSimilar(a, b) {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const maxLen = Math.max(na.length, nb.length);
  const threshold = Math.min(4, Math.max(1, Math.round(maxLen * 0.3)));
  return levenshtein(na, nb) <= threshold;
}

// Liefert die "Eintragen"-Events (keine Zahlungen) vom aktuellen Abend,
// neueste zuerst — Basis für Titel-Vorschlag und automatisches Zusammenführen.
function currentEveningEvents() {
  const key = eveningKey(new Date());
  const byId = new Map();
  for (const t of state.transactions) {
    if (!t.event_id || !t.events || t.events.entered_by_user_id) continue;
    if (eveningKey(t.created_at) !== key) continue;
    const existing = byId.get(t.event_id);
    const created = new Date(t.created_at);
    if (!existing || created > existing.latest) {
      byId.set(t.event_id, { id: t.event_id, name: t.events.name, latest: created });
    }
  }
  return [...byId.values()].sort((a, b) => b.latest - a.latest);
}

// ---------- Beträge parsen/formatieren ----------

function parseAmount(raw) {
  const cleaned = String(raw).trim().replace(/\s/g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!cleaned || !Number.isFinite(value)) return NaN;
  return Math.round(value * 100) / 100;
}

function fmtField(value) {
  return value > 0 ? value.toFixed(2).replace(".", ",") : "";
}

const PAYPAL_ME = "sjbstueberl";

// Hält den PayPal-Komfort-Link mit dem aktuell eingetragenen Betrag synchron.
// Öffnet paypal.me nur mit vorausgefülltem Betrag — trägt selbst nichts in
// die Datenbank ein, das bleibt der bestehende "Schulden begleichen"-Klick.
function updatePaypalLink() {
  const link = $("#paypal-link");
  if (!link) return;
  const amount = parseAmount($("#pay-amount").value);
  if (Number.isFinite(amount) && amount > 0) {
    // Deutschsprachige PayPal.me-Profile erwarten den Betrag offenbar im
    // deutschen Zahlenformat (Komma statt Punkt, z. B. "3,80") und über den
    // vollen paypalme-Pfad — mit US-Format (Punkt) landete der Link zuvor
    // nur auf der Profilseite ohne vorausgefüllten Betrag.
    const amountDE = amount.toFixed(2).replace(".", ",");
    link.href = `https://www.paypal.com/paypalme/${PAYPAL_ME}/${amountDE}`;
    link.removeAttribute("aria-disabled");
  } else {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
  }
}

function icon(ref, extraClass = "") {
  return `<svg class="icon ${extraClass}"><use href="${ref}"/></svg>`;
}

function tagChip(category) {
  const tag = TAGS.includes(category) ? category : "Pfarrjugend";
  const span = document.createElement("span");
  span.className = "tag " + tag.toLowerCase();
  span.textContent = tag;
  return span;
}

// ---------- Rendering ----------

function renderAll() {
  renderOverview();
  renderEntry();
  renderPersons();
  renderLog();
  if (state.sheet) renderSheet();
}

function renderOverview() {
  const bal = balances();

  const totalOpen = [...bal.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const debtorCount = [...bal.values()].filter((v) => v > 0).length;
  $("#stat-total").textContent = eur.format(totalOpen);
  $("#hero-sub").textContent = debtorCount === 0
    ? "Alles beglichen"
    : `${debtorCount} ${debtorCount === 1 ? "Person hat" : "Personen haben"} offene Schulden`;

  const sorted = [...state.users]
    .filter((u) => (bal.get(u.id) || 0) > 0.004)
    .sort((a, b) => {
      const diff = (bal.get(b.id) || 0) - (bal.get(a.id) || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name, "de");
    });

  const list = $("#ranking");
  list.innerHTML = "";

  if (state.users.length === 0) {
    list.innerHTML = '<li class="empty-hint">Noch keine Personen angelegt.</li>';
    return;
  }
  if (sorted.length === 0) {
    list.innerHTML = '<li class="empty-hint">Keine offenen Schulden — alles beglichen.</li>';
    return;
  }

  const medalClass = ["gold", "silver", "bronze"];
  sorted.forEach((u, i) => {
    const amount = bal.get(u.id) || 0;
    const li = document.createElement("li");

    const row = document.createElement("button");
    row.type = "button";
    row.className = "rank-row";
    row.addEventListener("click", () => openSheet("detail", u.id));

    const badge = document.createElement("span");
    badge.className = "rank-badge" + (i < 3 ? " " + medalClass[i] : "");
    badge.textContent = String(i + 1);

    const nameWrap = document.createElement("span");
    nameWrap.className = "rank-name";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = u.name;
    nameWrap.appendChild(name);
    // In der Übersicht nur Alumni/Extern-Tags zeigen — Pfarrjugend ist der Standard und wäre reines Rauschen.
    if (u.category === "Alumni" || u.category === "Extern") {
      nameWrap.appendChild(tagChip(u.category));
    }

    const value = document.createElement("span");
    value.className = "rank-amount";
    value.textContent = eur.format(amount);

    row.append(badge, nameWrap, value);
    row.insertAdjacentHTML("beforeend", `<svg class="chevron"><use href="#i-chevron"/></svg>`);
    li.appendChild(row);
    list.appendChild(li);
  });
}

function personButton(user, isSelected, onSelect) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "person-btn" + (isSelected ? " selected" : "");
  btn.textContent = user.name;
  btn.addEventListener("click", () => onSelect(user.id));
  return btn;
}

function renderEntry() {
  // Eintragen: Mehrfachauswahl für das Event (alphabetisch, scrollbar)
  const personGrid = $("#person-grid");
  personGrid.innerHTML = "";
  for (const u of state.users) {
    personGrid.appendChild(
      personButton(u, state.selection.has(u.id), (id) => {
        if (state.selection.has(id)) state.selection.delete(id);
        else state.selection.set(id, 0);
        renderEntry();
      })
    );
  }
  if (state.users.length === 0) {
    personGrid.innerHTML = '<p class="empty-hint">Noch keine Personen — im Tab „Personen“ anlegen.</p>';
  }

  $("#amount-section").hidden = state.selection.size === 0;
  renderAmountList();

  // Begleichen: Einzelauswahl + austragende Person
  const payGrid = $("#pay-person-grid");
  payGrid.innerHTML = "";
  for (const u of state.users) {
    payGrid.appendChild(
      personButton(u, u.id === state.payPersonId, (id) => {
        state.payPersonId = state.payPersonId === id ? null : id;
        if (state.witnessId === state.payPersonId) state.witnessId = null;
        // Vorschlagsbetrag: offener Saldo der ausgewählten Person
        const bal = state.payPersonId ? balances().get(state.payPersonId) || 0 : 0;
        $("#pay-amount").value = bal > 0 ? fmtField(bal) : "";
        updatePaypalLink();
        renderEntry();
      })
    );
  }

  const witnessGrid = $("#witness-grid");
  witnessGrid.innerHTML = "";
  // Nur Pfarrjugend-Mitglieder dürfen Zahlungen als "ausgetragen" bestätigen.
  const eligibleWitnesses = state.users.filter(
    (u) => u.id !== state.payPersonId && u.category === "Pfarrjugend"
  );
  for (const u of eligibleWitnesses) {
    witnessGrid.appendChild(
      personButton(u, u.id === state.witnessId, (id) => {
        state.witnessId = state.witnessId === id ? null : id;
        renderEntry();
      })
    );
  }
  if (eligibleWitnesses.length === 0) {
    witnessGrid.innerHTML = '<p class="empty-hint">Keine Pfarrjugend-Mitglieder verfügbar.</p>';
  }
}

function renderAmountList() {
  const list = $("#amount-list");
  list.innerHTML = "";

  for (const [personId, amount] of state.selection) {
    const row = document.createElement("div");
    row.className = "amount-row";

    const name = document.createElement("span");
    name.className = "amount-name";
    name.textContent = userName(personId);

    const minus = stepButton("#i-minus", "Betrag verringern", () => stepAmount(personId, -0.5));
    const plus = stepButton("#i-plus", "Betrag erhöhen", () => stepAmount(personId, 0.5));

    const field = document.createElement("input");
    field.type = "text";
    field.inputMode = "decimal";
    field.autocomplete = "off";
    field.className = "amount-field";
    field.placeholder = "0,00";
    field.value = fmtField(amount);
    field.addEventListener("change", () => {
      const value = parseAmount(field.value);
      state.selection.set(personId, Number.isFinite(value) && value > 0 ? value : 0);
      field.value = fmtField(state.selection.get(personId));
    });

    row.append(name, minus, field, plus);
    list.appendChild(row);
  }
}

function stepButton(iconRef, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "step-btn";
  btn.setAttribute("aria-label", label);
  btn.innerHTML = icon(iconRef, "icon-s");
  btn.addEventListener("click", onClick);
  return btn;
}

function stepAmount(personId, delta) {
  const current = state.selection.get(personId) || 0;
  const next = Math.max(0, Math.round((current + delta) * 100) / 100);
  state.selection.set(personId, next);
  renderAmountList();
}

// ---------- Personen-Tab ----------

function renderPersons() {
  const bal = balances();
  const list = $("#persons-list");
  list.innerHTML = "";

  if (state.users.length === 0) {
    list.innerHTML = '<p class="empty-hint">Noch keine Personen angelegt.</p>';
  }

  for (const u of state.users) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "person-row";
    row.addEventListener("click", () => openSheet("edit", u.id));

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.innerHTML = icon("#i-person");

    const info = document.createElement("span");
    info.className = "info";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = u.name;
    info.append(name, tagChip(u.category));

    const balance = document.createElement("span");
    balance.className = "balance";
    balance.textContent = eur.format(bal.get(u.id) || 0);

    row.append(avatar, info, balance);
    row.insertAdjacentHTML("beforeend", `<svg class="chevron"><use href="#i-chevron"/></svg>`);
    list.appendChild(row);
  }
}

function renderTagSelect(container, selected, onSelect) {
  container.innerHTML = "";
  for (const tag of TAGS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-btn" + (tag === selected ? " selected" : "");
    btn.textContent = tag;
    btn.addEventListener("click", () => onSelect(tag));
    container.appendChild(btn);
  }
}

// ---------- Sheet (Detail / Bearbeiten) ----------

function openSheet(type, id) {
  state.sheet = { type, id, draftTag: null };
  renderSheet();
  $("#sheet-backdrop").hidden = false;
  $("#sheet").hidden = false;
  requestAnimationFrame(() => {
    $("#sheet-backdrop").classList.add("open");
    $("#sheet").classList.add("open");
  });
}

function closeSheet() {
  state.sheet = null;
  $("#sheet-backdrop").classList.remove("open");
  $("#sheet").classList.remove("open");
  setTimeout(() => {
    $("#sheet-backdrop").hidden = true;
    $("#sheet").hidden = true;
  }, 320);
}

function renderSheet() {
  if (!state.sheet) return;
  const content = $("#sheet-content");
  content.innerHTML = "";

  if (state.sheet.type === "event") {
    const txs = state.transactions.filter((t) => t.event_id === state.sheet.id);
    if (txs.length === 0) { closeSheet(); return; }
    const event = txs[0].events;
    const date = new Date(txs[0].created_at);
    const total = txs.reduce((sum, t) => sum + Number(t.amount), 0);
    const uniquePersons = new Set(txs.map((t) => t.user_id)).size;

    const header = document.createElement("div");
    header.className = "sheet-header wrap";
    const h = document.createElement("h3");
    h.textContent = (event && event.name) || "Event";
    header.append(h);
    content.appendChild(header);

    const meta = document.createElement("p");
    meta.className = "sheet-meta";
    meta.textContent = `${uniquePersons} ${uniquePersons === 1 ? "Person" : "Personen"} · ${dateFmt.format(date)} · ${timeFmt.format(date)} Uhr`;
    content.appendChild(meta);

    const balance = document.createElement("p");
    balance.className = "sheet-balance " + (total < 0 ? "settled" : "debt");
    balance.textContent = (total < 0 ? "−" : "+") + eur.format(Math.abs(total));
    content.appendChild(balance);

    const label = document.createElement("p");
    label.className = "field-label";
    label.textContent = "Teilnehmer";
    content.appendChild(label);

    const tile = document.createElement("div");
    tile.className = "log-tile";
    for (const t of txs) {
      tile.appendChild(logRow({
        iconRef: "#i-person",
        iconClass: "person",
        title: userName(t.user_id),
        meta: `${timeFmt.format(new Date(t.created_at))} Uhr`,
        amount: Number(t.amount),
      }));
    }
    content.appendChild(tile);
    return;
  }

  const user = getUser(state.sheet.id);
  if (!user) { closeSheet(); return; }

  if (state.sheet.type === "detail") {
    const bal = balances().get(user.id) || 0;

    const header = document.createElement("div");
    header.className = "sheet-header";
    const h = document.createElement("h3");
    h.textContent = user.name;
    header.append(h, tagChip(user.category));
    content.appendChild(header);

    const balance = document.createElement("p");
    balance.className = "sheet-balance " + (bal > 0 ? "debt" : "settled");
    balance.textContent = (bal > 0 ? "Offen: " : "Stand: ") + eur.format(bal);
    content.appendChild(balance);

    const label = document.createElement("p");
    label.className = "field-label";
    label.textContent = "Verlauf";
    content.appendChild(label);

    const txs = state.transactions.filter((t) => t.user_id === user.id);
    if (txs.length === 0) {
      const hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "Noch keine Einträge.";
      content.appendChild(hint);
      return;
    }

    const tile = document.createElement("div");
    tile.className = "log-tile";
    for (const t of txs) {
      const amount = Number(t.amount);
      const isPayment = amount < 0;
      const date = new Date(t.created_at);
      let meta = `${shortDateFmt.format(date)} · ${timeFmt.format(date)} Uhr`;
      if (isPayment && t.events && t.events.entered_by_user_id) {
        meta += ` · ausgetragen von ${userName(t.events.entered_by_user_id)}`;
      }
      tile.appendChild(logRow({
        iconRef: isPayment ? "#i-check" : "#i-arrow-up",
        iconClass: isPayment ? "payment" : "debt",
        title: t.description || (isPayment ? "Zahlung" : "Schulden"),
        meta,
        amount,
      }));
    }
    content.appendChild(tile);
    return;
  }

  // type === "edit"
  const header = document.createElement("div");
  header.className = "sheet-header";
  const h = document.createElement("h3");
  h.textContent = "Person bearbeiten";
  header.append(h);
  content.appendChild(header);

  const nameLabel = document.createElement("label");
  nameLabel.className = "field-label";
  nameLabel.textContent = "Name";
  nameLabel.setAttribute("for", "edit-person-name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "edit-person-name";
  nameInput.className = "text-input";
  nameInput.autocomplete = "off";
  nameInput.value = user.name;

  const tagLabel = document.createElement("p");
  tagLabel.className = "field-label";
  tagLabel.textContent = "Tag";
  const tagSelect = document.createElement("div");
  tagSelect.className = "tag-select";
  const currentTag = () => state.sheet.draftTag || (TAGS.includes(user.category) ? user.category : "Pfarrjugend");
  const paintTags = () => renderTagSelect(tagSelect, currentTag(), (tag) => {
    state.sheet.draftTag = tag;
    paintTags();
  });
  paintTags();

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary-btn";
  save.textContent = "Speichern";
  save.addEventListener("click", async () => {
    const newName = nameInput.value.trim();
    if (!newName) return toast("Bitte einen Namen eingeben.", "error");
    const duplicate = state.users.some((u) => u.id !== user.id && u.name.toLowerCase() === newName.toLowerCase());
    if (duplicate) return toast(`„${newName}“ gibt es schon.`, "error");
    save.disabled = true;
    try {
      const { error } = await db
        .from("users")
        .update({ name: newName, category: currentTag() })
        .eq("id", user.id);
      if (error) throw error;
      closeSheet();
      await loadData();
      toast(`${newName} gespeichert`);
    } catch (err) {
      console.error(err);
      toast("Speichern fehlgeschlagen — bitte erneut versuchen.", "error");
    } finally {
      save.disabled = false;
    }
  });

  content.append(nameLabel, nameInput, tagLabel, tagSelect, save);
}

// ---------- Aktivitätenlog (jede Aktivität als Kachel) ----------

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Heute";
  if (sameDay(date, yesterday)) return "Gestern";
  return dateFmt.format(date);
}

function logRow({ iconRef, iconClass, title, meta, amount, header = false, onClick }) {
  const row = document.createElement("div");
  row.className = "log-row" + (header ? " header" : "");
  row.innerHTML = `
    <span class="log-icon ${iconClass}">${icon(iconRef)}</span>
    <div class="log-body">
      <div class="log-title"></div>
      <div class="log-meta"></div>
    </div>
    <span class="log-amount ${amount < 0 ? "payment" : "debt"}"></span>`;
  row.querySelector(".log-title").textContent = title;
  row.querySelector(".log-meta").textContent = meta;
  row.querySelector(".log-amount").textContent = (amount < 0 ? "−" : "+") + eur.format(Math.abs(amount));
  if (onClick) {
    row.classList.add("clickable");
    row.addEventListener("click", onClick);
  }
  return row;
}

// Durchsuchbarer Text einer Log-Gruppe: Event-Name, alle beteiligten
// Personen, austragende Person, Beschreibungen und mehrere Datumsformate.
function groupSearchText(g) {
  const parts = [];
  if (g.event && g.event.name) parts.push(g.event.name);
  for (const t of g.items) {
    parts.push(userName(t.user_id));
    if (t.description) parts.push(t.description);
    if (t.events && t.events.entered_by_user_id) parts.push(userName(t.events.entered_by_user_id));
  }
  const d = g.date;
  parts.push(shortDateFmt.format(d));   // 03.07.26
  parts.push(dateFmt.format(d));        // Freitag, 03.07.2026
  parts.push(monthYearFmt.format(d));   // Juli 2026
  parts.push(dayLabel(d));              // Heute / Gestern / …
  return parts.join(" ").toLowerCase();
}

function renderLog() {
  const list = $("#log-list");
  list.innerHTML = "";

  if (state.transactions.length === 0) {
    list.innerHTML = '<p class="empty-hint">Noch keine Einträge.</p>';
    return;
  }

  // Transaktionen (bereits absteigend sortiert) nach Event bündeln
  const groups = [];
  const byKey = new Map();
  for (const t of state.transactions) {
    const key = t.event_id || `tx-${t.id}`;
    if (!byKey.has(key)) {
      const group = { event: t.events, items: [], date: new Date(t.created_at) };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).items.push(t);
  }

  // Freitextsuche: alle Suchbegriffe müssen (in beliebiger Reihenfolge) passen.
  const tokens = state.logSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleGroups = tokens.length
    ? groups.filter((g) => {
        const text = groupSearchText(g);
        return tokens.every((tok) => text.includes(tok));
      })
    : groups;

  if (visibleGroups.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = `Keine Treffer für „${state.logSearch.trim()}“.`;
    list.appendChild(hint);
    return;
  }

  let currentDay = null;
  for (const g of visibleGroups) {
    const label = dayLabel(g.date);
    if (label !== currentDay) {
      currentDay = label;
      const h = document.createElement("p");
      h.className = "log-day";
      h.textContent = label;
      list.appendChild(h);
    }

    const tile = document.createElement("div");
    tile.className = "log-tile";
    const isPayment = g.items.every((t) => Number(t.amount) < 0);

    if (isPayment) {
      // Zahlung: eigene Kachel inkl. austragender Person
      for (const t of g.items) {
        const date = new Date(t.created_at);
        let meta = `${userName(t.user_id)} · ${timeFmt.format(date)} Uhr`;
        if (t.events && t.events.entered_by_user_id) {
          meta += ` · ausgetragen von ${userName(t.events.entered_by_user_id)}`;
        }
        tile.appendChild(logRow({
          iconRef: "#i-check",
          iconClass: "payment",
          title: t.description || "Zahlung",
          meta,
          amount: Number(t.amount),
          onClick: () => openSheet("event", t.event_id),
        }));
      }
    } else if (g.event) {
      const uniquePersons = new Set(g.items.map((t) => t.user_id));
      if (uniquePersons.size === 1) {
        // Nur eine Person an diesem Event beteiligt: keine eigene Kopfzeile —
        // stattdessen direkt als normale Zeile(n) mit dem Event-Namen als Titel.
        for (const t of g.items) {
          tile.appendChild(logRow({
            iconRef: "#i-calendar",
            iconClass: "event",
            title: g.event.name,
            meta: `${userName(t.user_id)} · ${timeFmt.format(new Date(t.created_at))} Uhr`,
            amount: Number(t.amount),
            onClick: () => openSheet("event", t.event_id),
          }));
        }
      } else {
        // Mehrere Personen: Kachel mit Kopfzeile und einer Zeile pro Person
        const total = g.items.reduce((sum, t) => sum + Number(t.amount), 0);
        tile.appendChild(logRow({
          iconRef: "#i-calendar",
          iconClass: "event",
          title: g.event.name,
          meta: `${uniquePersons.size} Personen · ${timeFmt.format(g.date)} Uhr`,
          amount: total,
          header: true,
          onClick: () => openSheet("event", g.items[0].event_id),
        }));
        for (const t of g.items) {
          tile.appendChild(logRow({
            iconRef: "#i-person",
            iconClass: "person",
            title: userName(t.user_id),
            meta: `${timeFmt.format(new Date(t.created_at))} Uhr`,
            amount: Number(t.amount),
          }));
        }
      }
    } else {
      // Einzelner Eintrag ohne Event (ältere Daten): ebenfalls eigene Kachel
      for (const t of g.items) {
        tile.appendChild(logRow({
          iconRef: "#i-arrow-up",
          iconClass: "debt",
          title: t.description || "Schulden",
          meta: `${userName(t.user_id)} · ${timeFmt.format(new Date(t.created_at))} Uhr`,
          amount: Number(t.amount),
        }));
      }
    }

    list.appendChild(tile);
  }
}

// ---------- Navigation & Segmented Controls ----------

function moveIndicator(container, activeBtn) {
  const indicator = container.querySelector(".seg-indicator");
  if (!indicator) return;
  if (!activeBtn) {
    indicator.style.opacity = "0";
    return;
  }
  indicator.style.opacity = "1";
  indicator.style.width = activeBtn.offsetWidth + "px";
  indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

function switchView(view, animate = true) {
  state.view = view;
  for (const section of document.querySelectorAll(".view")) {
    const isTarget = section.id === `view-${view}`;
    section.hidden = !isTarget;
    section.classList.remove("enter");
    if (isTarget && animate) {
      // Reflow erzwingen, damit die Animation bei jedem Wechsel neu startet.
      void section.offsetWidth;
      section.classList.add("enter");
    }
  }
  const bar = $("#tab-bar");
  for (const tab of bar.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  moveIndicator(bar, bar.querySelector(".tab.active"));
  $("#fab").classList.toggle("active", view === "entry");
  if (view === "entry") {
    // Erst nach dem Einblenden haben die Buttons eine messbare Breite
    moveIndicator($("#mode-seg"), $("#mode-seg .seg-btn.active"));
    if (state.mode === "add") fillEventSuggestion();
  }
}

function switchMode(mode) {
  state.mode = mode;
  const seg = $("#mode-seg");
  for (const btn of seg.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  moveIndicator(seg, seg.querySelector(".seg-btn.active"));

  $("#add-form").hidden = mode !== "add";
  $("#pay-form").hidden = mode !== "pay";
  const submit = $("#submit-btn");
  submit.textContent = mode === "pay" ? "Schulden begleichen" : "Eintragen";
  submit.classList.toggle("pay-mode", mode === "pay");
  if (mode === "pay") updatePaypalLink();
  if (mode === "add") fillEventSuggestion();
}

// Schlägt beim Öffnen von "Eintragen" automatisch den Titel des laufenden
// Abends vor (falls schon jemand etwas eingetragen hat), sofern das Feld
// noch leer ist — so landen mehrere Personen leicht im selben Event.
function fillEventSuggestion() {
  const input = $("#event-input");
  if (!input || input.value.trim()) return;
  const evening = currentEveningEvents();
  if (evening[0]) input.value = evening[0].name;
}

// ---------- Aktionen ----------

function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = "show " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

async function submitAdd() {
  if (state.selection.size === 0) return toast("Bitte mindestens eine Person auswählen.", "error");
  for (const [personId, amount] of state.selection) {
    if (!(amount > 0)) return toast(`Betrag fehlt für ${userName(personId)}.`, "error");
  }
  const eventName = $("#event-input").value.trim() || "Stüberl-Runde";

  // An ein bestehendes Event vom selben Abend anhängen, wenn der Titel ähnlich
  // genug ist (Groß-/Kleinschreibung, Leerzeichen, kleine Tippfehler egal) —
  // so landen mehrere Personen mit ähnlichem Eventnamen im selben Event statt
  // in getrennten. Sonst neues Event anlegen.
  const match = currentEveningEvents().find((e) => titlesSimilar(e.name, eventName));
  const finalName = match ? match.name : eventName;

  let eventId;
  if (match) {
    eventId = match.id;
  } else {
    const { data: event, error: eventError } = await db
      .from("events")
      .insert({ name: eventName })
      .select()
      .single();
    if (eventError) throw eventError;
    eventId = event.id;
  }

  const rows = [...state.selection.entries()].map(([userId, amount]) => ({
    user_id: userId,
    amount,
    description: finalName,
    event_id: eventId,
  }));
  const { error } = await db.from("transactions").insert(rows);
  if (error) throw error;

  const count = rows.length;
  $("#event-input").value = "";
  state.selection = new Map();
  await loadData();
  fillEventSuggestion();
  toast(`„${finalName}“ – ${count} ${count === 1 ? "Eintrag" : "Einträge"} gespeichert`);
}

async function submitPay() {
  const amount = parseAmount($("#pay-amount").value);
  if (!state.payPersonId) return toast("Bitte eine Person auswählen.", "error");
  if (!Number.isFinite(amount) || amount <= 0) return toast("Bitte einen gültigen Betrag eingeben.", "error");
  if (!state.witnessId) return toast("Bitte angeben, wer austrägt.", "error");
  if (state.witnessId === state.payPersonId) return toast("Man kann nicht für sich selbst austragen.", "error");

  const note = $("#note-input").value.trim();
  const payerName = userName(state.payPersonId);

  // Austragen: Event dokumentiert, wer den Eintrag vorgenommen hat.
  const { data: event, error: eventError } = await db
    .from("events")
    .insert({ name: note || "Zahlung", entered_by_user_id: state.witnessId })
    .select()
    .single();
  if (eventError) throw eventError;

  const { error } = await db.from("transactions").insert({
    user_id: state.payPersonId,
    amount: -amount,
    description: note || "Zahlung",
    event_id: event.id,
  });
  if (error) throw error;

  $("#pay-amount").value = "";
  $("#note-input").value = "";
  state.payPersonId = null;
  state.witnessId = null;
  updatePaypalLink();
  await loadData();
  toast(`${eur.format(amount)} von ${payerName} beglichen`);
}

async function submitEntry() {
  const btn = $("#submit-btn");
  btn.disabled = true;
  try {
    if (state.mode === "add") await submitAdd();
    else await submitPay();
  } catch (err) {
    console.error(err);
    toast("Speichern fehlgeschlagen — bitte erneut versuchen.", "error");
  } finally {
    btn.disabled = false;
  }
}

async function addPerson() {
  const input = $("#new-person-name");
  const name = input.value.trim();
  if (!name) return toast("Bitte einen Namen eingeben.", "error");
  if (state.users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
    return toast(`„${name}“ gibt es schon.`, "error");
  }
  const btn = $("#add-person-btn");
  btn.disabled = true;
  try {
    const { error } = await db.from("users").insert({ name, category: state.newPersonTag });
    if (error) throw error;
    input.value = "";
    await loadData();
    toast(`${name} wurde angelegt`);
  } catch (err) {
    console.error(err);
    toast("Anlegen fehlgeschlagen — bitte erneut versuchen.", "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Repaint erzwingen (iOS-Safari-Workaround) ----------

// Auf iOS Safari malt der Browser nach dem ersten async Datenladen manchmal
// nicht zuverlässig neu, wenn im selben Stacking-Kontext geblurte/transparente
// Flächen liegen (unsere Hintergrund-Washes, die Hero-Karte) — reine
// textContent-Änderungen bleiben dann bis zum nächsten "harten" Layout-
// Ereignis (z. B. Tab-Wechsel) unsichtbar "hängen". Wir erzwingen genau das:
// hidden kurz umschalten und einen Reflow abgreifen, ohne dass es sichtbar
// aufblitzt (geschieht synchron vor dem nächsten Paint).
function forceRepaint(view) {
  const section = document.getElementById(`view-${view}`);
  if (!section) return;
  const wasHidden = section.hidden;
  section.hidden = true;
  void section.offsetHeight;
  section.hidden = wasHidden;
}

// ---------- Sync-Status ----------

function setSyncStatus(status, label) {
  const el = $("#sync-status");
  el.classList.remove("online", "error");
  if (status) el.classList.add(status);
  $("#sync-label").textContent = label;
}

// ---------- Initialisierung ----------

function init() {
  // Navigation: Tab-Pille + Plus-Button
  for (const tab of document.querySelectorAll("#tab-bar .tab")) {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  }
  $("#fab").addEventListener("click", () => switchView("entry"));

  // Modus-Umschalter (Eintragen / Begleichen)
  for (const btn of document.querySelectorAll("#mode-seg .seg-btn")) {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  }

  // "Alle"-Schnellbeträge im Event-Eintrag
  $("#add-form").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.hasAttribute("data-all-clear")) {
      for (const id of state.selection.keys()) state.selection.set(id, 0);
    } else if (chip.dataset.allAdd) {
      for (const [id, value] of state.selection) {
        state.selection.set(id, Math.round((value + Number(chip.dataset.allAdd)) * 100) / 100);
      }
    }
    renderAmountList();
  });

  // Schnellbeträge beim Begleichen
  $("#pay-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const field = $("#pay-amount");
    if (chip.hasAttribute("data-clear")) {
      field.value = "";
    } else {
      const current = parseAmount(field.value);
      const base = Number.isFinite(current) && current > 0 ? current : 0;
      field.value = fmtField(base + Number(chip.dataset.add));
    }
    updatePaypalLink();
  });

  // Manuelle Betragseingabe hält den PayPal-Link ebenfalls synchron
  $("#pay-amount").addEventListener("input", updatePaypalLink);

  $("#submit-btn").addEventListener("click", submitEntry);

  // Neue Person (Personen-Tab)
  renderTagSelect($("#new-person-tags"), state.newPersonTag, function onTag(tag) {
    state.newPersonTag = tag;
    renderTagSelect($("#new-person-tags"), tag, onTag);
  });
  $("#add-person-btn").addEventListener("click", addPerson);
  $("#new-person-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPerson();
  });

  // Log-Suche
  const searchInput = $("#log-search");
  const searchClear = $("#log-search-clear");
  searchInput.addEventListener("input", () => {
    state.logSearch = searchInput.value;
    searchClear.hidden = searchInput.value.length === 0;
    renderLog();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.logSearch = "";
    searchClear.hidden = true;
    renderLog();
    searchInput.focus();
  });

  // Sheet schließen
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sheet) closeSheet();
  });

  // Indikatoren initial positionieren (nach Font-Load erneut).
  // Ohne Animation: sie beim allerersten Aufbau (noch vor Daten-/Layout-
  // Stabilisierung) zu starten, konnte zu einem eingefrorenen Zwischenbild
  // führen, das erst beim nächsten Tab-Wechsel "aufgeräumt" wurde.
  switchView("overview", false);
  switchMode("add");
  const reposition = () => {
    moveIndicator($("#tab-bar"), $("#tab-bar .tab.active"));
    if (state.view === "entry") moveIndicator($("#mode-seg"), $("#mode-seg .seg-btn.active"));
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("load", reposition);

  // Erste Daten + Live-Updates
  loadData()
    .then(() => {
      setSyncStatus("online", "Live");
      // Direkt nach dem ersten Rendern mit echten Daten erzwungen neu malen
      // (siehe forceRepaint-Kommentar) — sonst bleibt der Inhalt auf manchen
      // Geräten/Browsern bis zum nächsten Tab-Wechsel in einem Zwischenzustand.
      requestAnimationFrame(() => forceRepaint(state.view));
    })
    .catch((err) => {
      console.error(err);
      setSyncStatus("error", "Offline");
      toast("Verbindung fehlgeschlagen — bitte neu laden.", "error");
    });

  db.channel("db-changes")
    .on("postgres_changes", { event: "*", schema: "public" }, () => {
      loadData().catch(console.error);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("online", "Live");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncStatus(null, "Kein Live-Sync");
    });

  // Beim Zurückkehren in den Tab aktualisieren
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadData().catch(console.error);
  });
}

init();

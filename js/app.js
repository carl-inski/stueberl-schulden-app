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

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

// ---------- Zustand ----------

const state = {
  users: [],          // [{id, name, category, created_at}]
  transactions: [],   // [{id, user_id, amount, description, created_at, events: {name, entered_by_user_id} | null}]
  mode: "add",        // "add" | "pay"
  personId: null,     // ausgewählte Person
  witnessId: null,    // bestätigende Person (nur bei "pay")
  view: "overview",
};

const $ = (sel) => document.querySelector(sel);

// ---------- Daten laden ----------

async function loadData() {
  const [usersRes, txRes] = await Promise.all([
    db.from("users").select("*").order("name"),
    db.from("transactions")
      .select("*, events(name, entered_by_user_id)")
      .order("created_at", { ascending: false }),
  ]);
  if (usersRes.error || txRes.error) {
    throw usersRes.error || txRes.error;
  }
  state.users = usersRes.data;
  state.transactions = txRes.data;
  renderAll();
}

function userName(id) {
  const u = state.users.find((u) => u.id === id);
  return u ? u.name : "Unbekannt";
}

function balances() {
  const map = new Map(state.users.map((u) => [u.id, 0]));
  for (const t of state.transactions) {
    map.set(t.user_id, (map.get(t.user_id) || 0) + Number(t.amount));
  }
  return map;
}

// ---------- Rendering ----------

function renderAll() {
  renderOverview();
  renderPersonGrids();
  renderLog();
}

function renderOverview() {
  const bal = balances();

  const totalOpen = [...bal.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const debtorCount = [...bal.values()].filter((v) => v > 0).length;
  $("#stat-total").textContent = eur.format(totalOpen);
  $("#stat-debtors").textContent = String(debtorCount);

  const sorted = [...state.users].sort((a, b) => {
    const diff = (bal.get(b.id) || 0) - (bal.get(a.id) || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, "de");
  });

  const medals = ["🥇", "🥈", "🥉"];
  const list = $("#ranking");
  list.innerHTML = "";

  if (sorted.length === 0) {
    list.innerHTML = '<li class="empty-hint">Noch keine Personen angelegt.</li>';
    return;
  }

  sorted.forEach((u, i) => {
    const amount = bal.get(u.id) || 0;
    const li = document.createElement("li");
    li.className = "rank-row";

    const badge = document.createElement("span");
    const hasMedal = i < 3 && amount > 0;
    badge.className = "rank-badge" + (hasMedal ? " medal" : "");
    badge.textContent = hasMedal ? medals[i] : String(i + 1);

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = u.name;

    const value = document.createElement("span");
    value.className = "rank-amount" + (amount <= 0 ? " settled" : "");
    value.textContent = amount <= 0 && amount > -0.005 ? "0,00 €" : eur.format(amount);

    li.append(badge, name, value);
    list.appendChild(li);
  });
}

function personButton(user, selectedId, onSelect) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "person-btn" + (user.id === selectedId ? " selected" : "");
  btn.textContent = user.name;
  btn.addEventListener("click", () => onSelect(user.id));
  return btn;
}

function renderPersonGrids() {
  const personGrid = $("#person-grid");
  personGrid.innerHTML = "";
  for (const u of state.users) {
    personGrid.appendChild(
      personButton(u, state.personId, (id) => {
        state.personId = state.personId === id ? null : id;
        if (state.witnessId === state.personId) state.witnessId = null;
        renderPersonGrids();
      })
    );
  }
  if (state.users.length === 0) {
    personGrid.innerHTML = '<p class="empty-hint">Noch keine Personen — unten anlegen.</p>';
  }

  const witnessGrid = $("#witness-grid");
  witnessGrid.innerHTML = "";
  const others = state.users.filter((u) => u.id !== state.personId);
  for (const u of others) {
    witnessGrid.appendChild(
      personButton(u, state.witnessId, (id) => {
        state.witnessId = state.witnessId === id ? null : id;
        renderPersonGrids();
      })
    );
  }
}

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

function renderLog() {
  const list = $("#log-list");
  list.innerHTML = "";

  if (state.transactions.length === 0) {
    list.innerHTML = '<p class="empty-hint">Noch keine Einträge.</p>';
    return;
  }

  let currentDay = null;
  for (const t of state.transactions) {
    const date = new Date(t.created_at);
    const label = dayLabel(date);
    if (label !== currentDay) {
      currentDay = label;
      const h = document.createElement("p");
      h.className = "log-day";
      h.textContent = label;
      list.appendChild(h);
    }

    const amount = Number(t.amount);
    const isPayment = amount < 0;

    const row = document.createElement("div");
    row.className = "log-row";

    const icon = document.createElement("span");
    icon.className = "log-icon " + (isPayment ? "payment" : "debt");
    icon.textContent = isPayment ? "✓" : "🍺";

    const body = document.createElement("div");
    body.className = "log-body";

    const title = document.createElement("div");
    title.className = "log-title";
    title.textContent = t.description || (isPayment ? "Zahlung" : "Schulden");

    const meta = document.createElement("div");
    meta.className = "log-meta";
    let metaText = `${userName(t.user_id)} · ${timeFmt.format(date)} Uhr`;
    if (isPayment && t.events && t.events.entered_by_user_id) {
      metaText += ` · ausgetragen von ${userName(t.events.entered_by_user_id)}`;
    }
    meta.textContent = metaText;

    body.append(title, meta);

    const value = document.createElement("span");
    value.className = "log-amount " + (isPayment ? "payment" : "debt");
    value.textContent = (isPayment ? "−" : "+") + eur.format(Math.abs(amount));

    row.append(icon, body, value);
    list.appendChild(row);
  }
}

// ---------- Tabs & Segmented Controls ----------

function moveIndicator(container, activeBtn) {
  const indicator = container.querySelector(".seg-indicator");
  if (!indicator || !activeBtn) return;
  indicator.style.width = activeBtn.offsetWidth + "px";
  indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

function switchView(view) {
  state.view = view;
  for (const section of document.querySelectorAll(".view")) {
    section.hidden = section.id !== `view-${view}`;
  }
  const bar = $("#tab-bar");
  for (const tab of bar.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  moveIndicator(bar, bar.querySelector(".tab.active"));
}

function switchMode(mode) {
  state.mode = mode;
  const seg = $("#mode-seg");
  for (const btn of seg.querySelectorAll(".seg-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  moveIndicator(seg, seg.querySelector(".seg-btn.active"));

  $("#pay-extra").hidden = mode !== "pay";
  const submit = $("#submit-btn");
  submit.textContent = mode === "pay" ? "Schulden begleichen" : "Schulden eintragen";
  submit.classList.toggle("pay-mode", mode === "pay");
}

// ---------- Eingaben ----------

function parseAmount() {
  const raw = $("#amount-input").value.trim().replace(/\s/g, "").replace(",", ".");
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return NaN;
  return Math.round(value * 100) / 100;
}

function setAmount(value) {
  $("#amount-input").value = value > 0 ? value.toFixed(2).replace(".", ",") : "";
}

function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = "show " + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

async function submitEntry() {
  const btn = $("#submit-btn");
  const amount = parseAmount();
  const description = $("#desc-input").value.trim();

  if (!state.personId) return toast("Bitte eine Person auswählen.", "error");
  if (!Number.isFinite(amount) || amount <= 0) return toast("Bitte einen gültigen Betrag eingeben.", "error");
  if (state.mode === "pay") {
    if (!state.witnessId) return toast("Bitte angeben, wer austrägt.", "error");
    if (state.witnessId === state.personId) return toast("Man kann nicht für sich selbst austragen.", "error");
  }

  btn.disabled = true;
  try {
    let message;
    if (state.mode === "add") {
      const { error } = await db.from("transactions").insert({
        user_id: state.personId,
        amount: amount,
        description: description || "Schulden",
      });
      if (error) throw error;
      message = `${eur.format(amount)} für ${userName(state.personId)} eingetragen ✓`;
    } else {
      // Austragen: Event dokumentiert, wer den Eintrag vorgenommen hat.
      const { data: event, error: eventError } = await db
        .from("events")
        .insert({
          name: description || "Zahlung",
          entered_by_user_id: state.witnessId,
        })
        .select()
        .single();
      if (eventError) throw eventError;

      const { error } = await db.from("transactions").insert({
        user_id: state.personId,
        amount: -amount,
        description: description || "Zahlung",
        event_id: event.id,
      });
      if (error) throw error;
      message = `${eur.format(amount)} von ${userName(state.personId)} beglichen ✓`;
    }

    setAmount(0);
    $("#desc-input").value = "";
    state.personId = null;
    state.witnessId = null;
    await loadData();
    toast(message);
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
    const { error } = await db.from("users").insert({ name });
    if (error) throw error;
    input.value = "";
    $("#add-person-form").hidden = true;
    toast(`${name} wurde angelegt ✓`);
    await loadData();
  } catch (err) {
    console.error(err);
    toast("Anlegen fehlgeschlagen — bitte erneut versuchen.", "error");
  } finally {
    btn.disabled = false;
  }
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
  // Tab-Navigation
  for (const tab of document.querySelectorAll("#tab-bar .tab")) {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  }

  // Modus-Umschalter (Eintragen / Begleichen)
  for (const btn of document.querySelectorAll("#mode-seg .seg-btn")) {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  }

  // Schnellbeträge
  $("#quick-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.hasAttribute("data-clear")) {
      setAmount(0);
      return;
    }
    const current = parseAmount();
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    setAmount(base + Number(chip.dataset.add));
  });

  $("#submit-btn").addEventListener("click", submitEntry);

  $("#add-person-toggle").addEventListener("click", () => {
    const form = $("#add-person-form");
    form.hidden = !form.hidden;
    if (!form.hidden) $("#new-person-name").focus();
  });
  $("#add-person-btn").addEventListener("click", addPerson);
  $("#new-person-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addPerson();
  });

  // Indikatoren initial positionieren (nach Font-Load erneut)
  switchView("overview");
  switchMode("add");
  window.addEventListener("resize", () => {
    moveIndicator($("#tab-bar"), $("#tab-bar .tab.active"));
    moveIndicator($("#mode-seg"), $("#mode-seg .seg-btn.active"));
  });
  window.addEventListener("load", () => {
    moveIndicator($("#tab-bar"), $("#tab-bar .tab.active"));
    moveIndicator($("#mode-seg"), $("#mode-seg .seg-btn.active"));
  });

  // Erste Daten + Live-Updates
  loadData()
    .then(() => setSyncStatus("online", "Live"))
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

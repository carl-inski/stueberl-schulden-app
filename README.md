# Stüberl-Schulden 🍺

Eine kleine Web-App zum Schuldentracken im Pfarrei-Stüberl.

## Bereiche

1. **Übersicht** — Rangliste, wer am meisten Schulden hat, plus Gesamtsumme.
2. **Eintragen** — Schulden hinzufügen oder begleichen. Beim Begleichen muss
   eine **andere Person** angegeben werden, die den Eintrag austrägt — das wird
   im Log dokumentiert. Neue Personen können jederzeit angelegt werden.
3. **Log** — Aktivitätenlog: was wann eingetragen bzw. beglichen wurde und von wem.

Alle Geräte sind über Supabase-Realtime live synchron.

## Technik

- Statische Website: `index.html`, `css/style.css`, `js/app.js` — kein Build-Step.
- Datenhaltung: [Supabase](https://supabase.com)-Projekt `stueberl-schulden`
  (Tabellen `users`, `transactions`, `events`). Der im Code hinterlegte
  Publishable Key ist für den Client-Einsatz gedacht.
- Design: "Liquid Glass" Dark-UI — CSS-Variablen in `:root`, eine `.glass`-Utility-Klasse,
  animierte Hintergrund-Blobs, Safe-Area-Insets für iOS.

## Hosting über GitHub Pages

1. Branch in `main` mergen (oder direkt den gewünschten Branch verwenden).
2. Im Repo: **Settings → Pages → Source: Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
3. Die Seite ist danach unter `https://<username>.github.io/stueberl-schulden-app/` erreichbar.

## Lokal testen

Einfach einen statischen Server starten, z. B.:

```bash
python3 -m http.server 8000
```

und `http://localhost:8000` öffnen.

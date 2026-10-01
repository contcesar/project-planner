# Project Planner

A kanban board for tracking projects and the clients they belong to.

It is a Progressive Web App (PWA): plain HTML, CSS and JavaScript with no build step. One codebase runs in the browser, installs on a Mac, and installs on an iPhone.

## Features

- Five columns: Backlog, To do, In progress, Review, Done
- Projects with a name, client, due date and notes
- Clients with their own color, shown on each card
- Filter by client and search by text
- Drag and drop with a mouse, or press and hold a card on a phone
- Overdue dates show in red
- Works offline
- Export and import a JSON backup from the `⋯` menu

## Run it locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Put it online (GitHub Pages)

1. Merge this code into `main`.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow publishes the site on every push to `main`.

The site will be at `https://<your-user>.github.io/project-planner/`.

## Install it as an app

- **iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**.
- **Mac:** open the site in Safari, then choose **File → Add to Dock**. In Chrome, use the install icon in the address bar.

The app then opens in its own window with no browser bar.

## Cloud sync with Supabase

With Supabase set up, you sign in once on each device and they all share one board. Changes show up on your other devices within a second or two.

Changes save on the device first, so the app stays fast and works offline. Anything made offline uploads when the connection comes back. A dot next to the app name shows the sync state: green for synced, yellow for syncing, red for an error.

### Setup (about 5 minutes)

1. Create a free project at https://supabase.com.
2. Open **SQL Editor → New query**, paste in `supabase/schema.sql`, and click **Run**. This creates the `clients` and `projects` tables, locks each row to its owner, and turns on live updates.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js`.
4. Open **Authentication → URL Configuration** and set **Site URL** to your GitHub Pages address. Confirmation emails link back there.
5. Deploy, open the app, and click **Create account**. Confirm the email, then sign in.
6. Optional but recommended: once your account exists, turn off **Allow new users to sign up** under **Authentication → Sign In / Providers**. Strangers then cannot create accounts. Row Level Security already keeps each account's data private either way.

The anon key is meant to be public. Row Level Security stops anyone from reading or changing data they do not own.

Any projects already on a device upload automatically the first time you sign in there.

On the free plan, Supabase pauses a project after a week with no activity. Open the Supabase dashboard to restore it.

### Local-only mode

If `config.js` is left empty, the app skips sign-in and keeps data only in the browser on that device. **Export backup** and **Import backup** in the `⋯` menu still work in both modes.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout and dialogs |
| `styles.css` | Styles, light and dark mode |
| `app.js` | Board, cards, clients, drag and drop |
| `cloud.js` | Supabase sign-in and sync |
| `config.js` | Supabase URL and key |
| `supabase/schema.sql` | Database tables and security rules |
| `sw.js` | Offline support |
| `vendor/` | Supabase JS library, stored locally so the app loads offline |

## Roadmap

1. Native wrappers for the App Store and Mac App Store with Capacitor, if the home screen app is not enough.

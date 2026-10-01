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

## Where data lives

Data is saved in the browser's local storage on each device. The Mac and the iPhone each keep their own copy. Use **Export backup** and **Import backup** to move data between them.

Cloud sync is the next step (see below).

## Roadmap

1. Cloud sync with sign-in, so every device shares one board (for example Supabase or Firebase).
2. Native wrappers for the App Store and Mac App Store with Capacitor, if the home screen app is not enough.

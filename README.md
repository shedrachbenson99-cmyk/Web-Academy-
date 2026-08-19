# Web Academy — Frontend

A single self-contained `index.html` — React, Tailwind, and icon/chart
libraries loaded from CDNs, with the entire app (all three roles: student,
instructor, admin) written as one React component.

## Run it

Just open `index.html` in a browser. No build step, no npm install. It needs
an internet connection on first load (to fetch React/Tailwind/etc. from
CDNs) but runs entirely client-side after that.

You can also serve it locally instead of double-clicking the file (some
browsers restrict local `file://` pages slightly more than served ones):

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Student | `student@webacademy.test` | `Student123!` |
| Instructor | `instructor@webacademy.test` | `Instructor123!` |
| Admin | `admin@webacademy.test` | `Admin123!` |

## Current data layer: browser localStorage (not the backend yet)

**Important:** this frontend does **not** currently call the `../backend`
API. It persists everything in the browser's `localStorage`, which means:

- Data is local to whichever browser/device opened the page — not shared
  between users or devices
- There is no real multi-user behavior yet (an instructor grading an
  assignment on one device won't be seen by a student on another device)

Wiring this frontend to call the real backend API instead is a separate,
substantial task (replacing every local read/write with a `fetch()` call,
adding a real token-based login flow, handling loading/error states for
network requests). See the root README for status.

## Deploying it

Since it's a single static HTML file, you can host it almost anywhere for
free:
- **GitHub Pages**: enable Pages on this repo, pointed at `/frontend`
- **Netlify / Vercel**: drag-and-drop deploy, or connect the repo
- Any static file host works — there's no server-side rendering involved

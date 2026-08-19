# Web Academy API

A real backend for Web Academy: authentication, courses, enrollment, progress
tracking, server-graded quizzes, assignments & grading, announcements,
certificates with public verification, notifications, and admin management.

**Zero npm dependencies.** It uses only Node's built-in modules:
- `node:http` for the server (with a tiny custom router — see `router.js`)
- `node:sqlite` for the database (built into Node 22.5+, no native module to compile)
- `node:crypto` for password hashing (scrypt) and session tokens

That means setup is just: install Node, run one command. No `npm install`,
no native build tools, no version-conflict headaches.

## Requirements

- **Node.js 22.5 or later** (for built-in `node:sqlite`). Check with `node -v`.
  If you're on an older Node, either upgrade (recommended) or ask for a
  variant using `better-sqlite3` instead.

## Run it locally

```bash
node server.js
```

That's it. On first run it creates `webacademy.db` in this folder and seeds
it with the same demo accounts and courses as the frontend:

| Role | Email | Password |
|---|---|---|
| Student | `student@webacademy.test` | `Student123!` |
| Instructor | `instructor@webacademy.test` | `Instructor123!` |
| Admin | `admin@webacademy.test` | `Admin123!` |

The server listens on `http://localhost:4000` by default. Override with
`PORT=8080 node server.js`.

## Run the test suite

A full end-to-end test suite (42 checks, including permission boundaries and
quiz-grading integrity) is included:

```bash
node --no-warnings server.js &   # start the server in the background
sleep 1
node test.mjs                    # run the tests
```

## Deploying it somewhere real

Since it's zero-dependency, deployment is simple on almost any Node host:

- **Render / Railway / Fly.io**: connect the repo, set the start command to
  `node server.js`, and set a `PORT` env var if the platform requires it
  (most inject `PORT` automatically). Add a persistent volume/disk for
  `webacademy.db` if you want data to survive redeploys — otherwise it resets.
- **A VPS**: `git clone`, then run with `pm2 start server.js` or a `systemd`
  service so it stays running and restarts on crash.
- Set `DB_PATH=/path/to/data/webacademy.db` as an env var to control where
  the SQLite file lives (useful for mounting a persistent disk).

## API overview

All authenticated routes expect `Authorization: Bearer <token>` (returned by
login/register). Errors return `{ "error": "message" }` with an appropriate
HTTP status.

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Courses | `GET /api/courses`, `GET /api/courses/:id`, `POST /api/courses` (instructor/admin), `PUT /api/courses/:id`, `DELETE /api/courses/:id` |
| Categories/Settings | `GET/POST/DELETE /api/categories`, `GET/PUT /api/settings` |
| Enrollment | `POST /api/enrollments`, `GET /api/enrollments/me`, `GET /api/courses/:id/students` |
| Progress | `POST /api/progress`, `GET /api/progress/me` |
| Quizzes | `POST /api/quiz-attempts` (graded server-side, not trusting the client), `GET /api/quiz-attempts/me` |
| Assignments | `GET /api/assignments`, `POST /api/assignments`, `PUT /api/assignments/:id`, `DELETE /api/assignments/:id` |
| Submissions | `POST /api/submissions`, `GET /api/submissions`, `PUT /api/submissions/:id/grade` |
| Announcements | `GET /api/announcements`, `POST /api/announcements`, `DELETE /api/announcements/:id`, `POST /api/announcements/:id/read` |
| Certificates | `POST /api/certificates`, `GET /api/certificates/me`, `GET /api/certificates/verify/:idOrCode` (public), `PUT /api/certificates/:id/revoke` (admin) |
| Notifications | `GET /api/notifications/me`, `PUT /api/notifications/:id/read` |
| Admin | `GET/POST /api/users`, `PUT /api/users/:id/suspend`, `DELETE /api/users/:id`, `GET /api/admin/stats` |

## What's NOT done yet

**The React frontend (the .jsx / standalone HTML file) does not talk to this
API yet.** It still uses browser `localStorage` for everything. Wiring the
frontend to call this backend instead — replacing every `window.storage`
call with a `fetch()` to these endpoints, plus a real login flow that stores
the token — is a separate, substantial piece of work. Ask if you want that
done next.

## Security notes (honest, not marketing)

- Passwords are hashed with scrypt + per-user salt, compared with a
  constant-time check — this is solid, not a toy.
- Quiz grading happens server-side from the stored correct answers, so a
  student can't fake a score by editing client-side JavaScript.
- Certificates are only issued after the server independently verifies 100%
  completion — not because the client claims it.
- Sessions are opaque random tokens stored server-side (not JWTs), so
  revoking a session (e.g. on suspend) is immediate and real.
- This has **not** been hardened for production-scale abuse (no rate
  limiting, no CSRF protection beyond token-based auth, no HTTPS handled
  here — put it behind a reverse proxy like Caddy/nginx or your host's TLS
  termination for that).

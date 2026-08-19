# Web Academy

A full-featured Learning Management System — student, instructor, and admin
roles, courses, quizzes, assignments, certificates, and more.

This repo has two independent parts:

```
web-academy/
├── frontend/   — static React app (open index.html directly, or deploy anywhere static)
└── backend/    — zero-dependency Node.js REST API + SQLite
```

## Status: not yet connected

The frontend currently persists data in the browser's `localStorage`. The
backend is a complete, tested REST API. **They don't talk to each other
yet** — see `frontend/README.md` for details. Each has its own demo
accounts and works standalone for now.

## Quick start

**Backend:**
```bash
cd backend
node server.js          # requires Node.js 22.5+, zero npm install needed
```

**Frontend:**
```bash
cd frontend
npx serve .              # or just open index.html directly in a browser
```

## Demo accounts (both frontend and backend, same credentials)

| Role | Email | Password |
|---|---|---|
| Student | `student@webacademy.test` | `Student123!` |
| Instructor | `instructor@webacademy.test` | `Instructor123!` |
| Admin | `admin@webacademy.test` | `Admin123!` |

See `backend/README.md` for the full API reference and deployment notes,
and `frontend/README.md` for frontend deployment notes.

## License

MIT

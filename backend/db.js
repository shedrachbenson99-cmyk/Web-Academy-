// db.js — SQLite schema, connection, and demo seed data.
// Uses Node's built-in node:sqlite (Node 22.5+) — no npm install required.
"use strict";
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword } = require("./auth");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "webacademy.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  instructor TEXT NOT NULL,
  instructor_id TEXT,
  rating REAL NOT NULL DEFAULT 5.0,
  students INTEGER NOT NULL DEFAULT 0,
  duration TEXT NOT NULL DEFAULT '',
  thumbnail_icon TEXT NOT NULL DEFAULT 'BookOpen',
  description TEXT NOT NULL DEFAULT '',
  objectives TEXT NOT NULL DEFAULT '[]',
  requirements TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'lesson' | 'quiz'
  title TEXT NOT NULL,
  duration TEXT DEFAULT '',
  content TEXT DEFAULT '',
  code TEXT,
  code_lang TEXT,
  pass_percent INTEGER DEFAULT 70,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'mc' | 'tf'
  question TEXT NOT NULL,
  options TEXT, -- JSON array (mc only)
  correct TEXT NOT NULL, -- JSON-encoded (int for mc, bool for tf)
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL,
  UNIQUE(student_id, course_id)
);

CREATE TABLE IF NOT EXISTS progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
  UNIQUE(student_id, item_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  review TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  due_date TEXT,
  max_score INTEGER NOT NULL DEFAULT 100,
  created_by TEXT,
  author_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  course_id TEXT NOT NULL,
  text_answer TEXT DEFAULT '',
  file_name TEXT,
  file_data TEXT,
  submitted_at TEXT NOT NULL,
  grade INTEGER,
  feedback TEXT,
  graded_at TEXT,
  UNIQUE(assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL, -- 'platform' | 'course'
  course_id TEXT,
  course_title TEXT,
  author_id TEXT,
  author_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS read_announcements (
  student_id TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  PRIMARY KEY (student_id, announcement_id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  instructor TEXT,
  date TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- JSON {route, params}
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

// ---- Seed demo data on first run only ----
function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount > 0) return; // already seeded

  const now = new Date().toISOString();
  const demoUsers = [
    { id: "demo-student", full_name: "Jordan Rivera", username: "jordan.demo", email: "student@webacademy.test", role: "student", pw: "Student123!" },
    { id: "demo-instructor", full_name: "Maya Chen", username: "maya.instructor", email: "instructor@webacademy.test", role: "instructor", pw: "Instructor123!" },
    { id: "demo-admin", full_name: "Avery Admin", username: "avery.admin", email: "admin@webacademy.test", role: "admin", pw: "Admin123!" },
  ];
  const insertUser = db.prepare(`INSERT INTO users (id, full_name, username, email, phone, role, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const u of demoUsers) {
    const { hash, salt } = hashPassword(u.pw);
    insertUser.run(u.id, u.full_name, u.username, u.email, "", u.role, hash, salt, now);
  }

  const categories = ["Web Development", "AI Development", "Graphics Design", "Digital Skills", "Programming Languages", "Databases", "Mobile Development", "Cloud & DevOps", "Cybersecurity", "Game Development"];
  const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
  for (const c of categories) insertCat.run(c);

  const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  insertSetting.run("siteName", "WEB ACADEMY");
  insertSetting.run("tagline", "Learn. Build. Create. Grow.");

  const insertCourse = db.prepare(`INSERT INTO courses (id, title, category, level, instructor, instructor_id, rating, students, duration, thumbnail_icon, description, objectives, requirements, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertModule = db.prepare(`INSERT INTO modules (id, course_id, title, position) VALUES (?,?,?,?)`);
  const insertItem = db.prepare(`INSERT INTO items (id, module_id, course_id, type, title, duration, content, code, code_lang, pass_percent, position) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertQ = db.prepare(`INSERT INTO quiz_questions (id, item_id, type, question, options, correct, position) VALUES (?,?,?,?,?,?,?)`);

  const courseId = "web-dev";
  insertCourse.run(
    courseId, "Complete Web Development", "Web Development", "Beginner", "Maya Chen", "demo-instructor",
    4.8, 1240, "8 weeks", "Code2",
    "Go from zero to a deployed portfolio site. Learn HTML, CSS, JavaScript, and Git through short lessons and real practice.",
    JSON.stringify(["Structure and style real web pages with HTML and CSS", "Build interactive pages with JavaScript and the DOM", "Use Git and GitHub to track and share your work"]),
    JSON.stringify(["A computer with a modern web browser", "No prior coding experience required"]),
    now
  );
  const m1 = uid("mod");
  insertModule.run(m1, courseId, "Introduction to Web Development", 0);
  const l1 = uid("item");
  insertItem.run(l1, m1, courseId, "lesson", "What Is Web Development?", "6 min",
    "Web development splits into the front end (what a visitor sees) and the back end (data, logic, storage). This course focuses on front-end fundamentals: HTML for structure, CSS for style, and JavaScript for behavior.",
    null, null, null, 0);
  const l2 = uid("item");
  insertItem.run(l2, m1, courseId, "lesson", "How the Web Works", "7 min",
    "Your browser sends an HTTP request to a server; the server responds with HTML, CSS, and JavaScript files that your browser assembles into a page.",
    null, null, null, 1);
  const q1 = uid("item");
  insertItem.run(q1, m1, courseId, "quiz", "Module Quiz: Getting Started", null, null, null, null, 70, 2);
  insertQ.run(uid("q"), q1, "mc", "Which language is primarily used to structure content on a webpage?", JSON.stringify(["HTML", "CSS", "JavaScript", "SQL"]), JSON.stringify(0), 0);
  insertQ.run(uid("q"), q1, "tf", "A web browser sends an HTTP request to a server when you visit a website.", null, JSON.stringify(true), 1);

  const m2 = uid("mod");
  insertModule.run(m2, courseId, "HTML Fundamentals", 1);
  const l3 = uid("item");
  insertItem.run(l3, m2, courseId, "lesson", "HTML Structure & Elements", "8 min",
    "Every HTML document follows the same skeleton: doctype, <html>, <head>, and <body>. Elements are written as tags, most with opening and closing pairs.",
    `<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Hello, Web Academy</h1>\n  </body>\n</html>`, "html", null, 0);
  const q2 = uid("item");
  insertItem.run(q2, m2, courseId, "quiz", "Module Quiz: HTML Fundamentals", null, null, null, null, 70, 1);
  insertQ.run(uid("q"), q2, "mc", "Which tag is used to create a hyperlink?", JSON.stringify(["<link>", "<a>", "<href>", "<nav>"]), JSON.stringify(1), 0);

  // A second seeded course to prove multi-course support end-to-end
  const courseId2 = "python-fundamentals";
  insertCourse.run(
    courseId2, "Python Programming Fundamentals", "Programming Languages", "Beginner", "Sofia Marin", null,
    4.9, 640, "6 weeks", "Terminal",
    "A hands-on introduction to Python — variables, control flow, functions, and data structures.",
    JSON.stringify(["Write and run real Python scripts", "Use core data structures effectively"]),
    JSON.stringify(["No prior coding experience required"]),
    now
  );
  const pm1 = uid("mod");
  insertModule.run(pm1, courseId2, "Python Basics", 0);
  const pl1 = uid("item");
  insertItem.run(pl1, pm1, courseId2, "lesson", "Variables & Data Types", "6 min",
    "Python variables are dynamically typed — you don't declare a type up front. Core types include int, float, str, bool, list, and dict.",
    `name = "Ada"\nage = 28\nis_student = True`, "python", null, 0);
  const pq1 = uid("item");
  insertItem.run(pq1, pm1, courseId2, "quiz", "Module Quiz: Python Basics", null, null, null, null, 70, 1);
  insertQ.run(uid("q"), pq1, "tf", "Python requires you to declare a variable's type before assigning it.", null, JSON.stringify(false), 0);

  const insertAssignment = db.prepare(`INSERT INTO assignments (id, course_id, module_id, title, description, instructions, due_date, max_score, created_by, author_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insertAssignment.run(uid("asg"), courseId, m2, "Build a Personal Bio Page",
    "Create a single HTML page introducing yourself using semantic elements.",
    "Include a heading, a short bio, and one image with alt text. Submit your HTML as the answer text.",
    null, 100, "demo-instructor", "Maya Chen", now);

  console.log("Database seeded with demo users and courses.");
}

seed();

module.exports = { db, uid };

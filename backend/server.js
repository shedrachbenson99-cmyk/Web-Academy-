// server.js — Web Academy REST API.
// Zero external dependencies: run with `node server.js` on Node 22.5+.
"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const { db, uid } = require("./db");
const { hashPassword, verifyPassword, generateToken } = require("./auth");
const { Router, handleRequest, sendJson } = require("./router");

const PORT = process.env.PORT || 4000;
const SESSION_DAYS = 30;
const router = new Router();

/* ---------------- helpers ---------------- */
function publicUser(u) {
  return { id: u.id, fullName: u.full_name, username: u.username, email: u.email, phone: u.phone, role: u.role, suspended: !!u.suspended };
}
function err(status, message) { const e = new Error(message); e.status = status; return e; }

function getCourseFull(courseId) {
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
  if (!course) return null;
  const modules = db.prepare("SELECT * FROM modules WHERE course_id = ? ORDER BY position").all(courseId);
  const items = db.prepare("SELECT * FROM items WHERE course_id = ? ORDER BY position").all(courseId);
  const questionsByItem = {};
  for (const it of items) {
    if (it.type === "quiz") {
      questionsByItem[it.id] = db.prepare("SELECT * FROM quiz_questions WHERE item_id = ? ORDER BY position").all(it.id)
        .map((q) => ({ id: q.id, type: q.type, question: q.question, options: q.options ? JSON.parse(q.options) : null, correct: JSON.parse(q.correct) }));
    }
  }
  return {
    id: course.id, title: course.title, category: course.category, level: course.level,
    instructor: course.instructor, instructorId: course.instructor_id, rating: course.rating,
    students: course.students, duration: course.duration, thumbnailIcon: course.thumbnail_icon,
    description: course.description, objectives: JSON.parse(course.objectives), requirements: JSON.parse(course.requirements),
    modules: modules.map((m) => ({
      id: m.id, title: m.title,
      items: items.filter((it) => it.module_id === m.id).map((it) => ({
        id: it.id, type: it.type, title: it.title, duration: it.duration,
        content: it.content, code: it.code, codeLang: it.code_lang,
        passPercent: it.pass_percent, questions: it.type === "quiz" ? questionsByItem[it.id] : undefined,
      })),
    })),
  };
}
function flattenItemIds(courseId) {
  return db.prepare("SELECT id FROM items WHERE course_id = ?").all(courseId).map((r) => r.id);
}
function courseProgressPct(studentId, courseId) {
  const itemIds = flattenItemIds(courseId);
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => "?").join(",");
  const done = db.prepare(`SELECT COUNT(*) AS n FROM progress WHERE student_id = ? AND item_id IN (${placeholders})`).get(studentId, ...itemIds).n;
  return Math.round((done / itemIds.length) * 100);
}
function pushNotification(userId, { title, message, link }) {
  db.prepare("INSERT INTO notifications (id, user_id, title, message, link, read, created_at) VALUES (?,?,?,?,?,0,?)")
    .run(uid("notif"), userId, title, message, link ? JSON.stringify(link) : null, new Date().toISOString());
}

/* ---------------- middleware ---------------- */
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return next(err(401, "Missing or invalid Authorization header"));
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session || new Date(session.expires_at) < new Date()) return next(err(401, "Session expired or invalid"));
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!user) return next(err(401, "User not found"));
  if (user.suspended) return next(err(403, "This account has been suspended"));
  user.fullName = user.full_name; // normalize for handlers that read camelCase
  req.user = user;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return next(err(403, `Requires role: ${roles.join(" or ")}`));
    next();
  };
}

/* ================= AUTH ================= */
router.post("/api/auth/register", async (req, res) => {
  const { fullName, username, email, phone, password } = req.body;
  if (!fullName?.trim()) throw err(400, "Full name is required.");
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username || "")) throw err(400, "Username must be 3-20 characters (letters, numbers, dots, underscores).");
  if (!/^\S+@\S+\.\S+$/.test(email || "")) throw err(400, "Enter a valid email address.");
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password || "")) throw err(400, "Password needs 8+ characters with a letter and a number.");
  if (db.prepare("SELECT 1 FROM users WHERE lower(email) = lower(?)").get(email)) throw err(409, "An account already uses this email.");
  if (db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(username)) throw err(409, "That username is taken.");

  const { hash, salt } = hashPassword(password);
  const id = uid("u");
  db.prepare("INSERT INTO users (id, full_name, username, email, phone, role, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, fullName.trim(), username.trim(), email.trim(), (phone || "").trim(), "student", hash, salt, new Date().toISOString());

  const token = generateToken();
  const now = new Date();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(token, id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString());
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  sendJson(res, 201, { token, user: publicUser(user) });
});

router.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) throw err(400, "Enter your email/username and password.");
  const user = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)").get(identifier, identifier);
  if (!user) throw err(401, "No account found with that email or username.");
  if (user.suspended) throw err(403, "This account has been suspended.");
  if (!verifyPassword(password, user.password_hash, user.password_salt)) throw err(401, "Incorrect password.");

  const token = generateToken();
  const now = new Date();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(token, user.id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString());
  sendJson(res, 200, { token, user: publicUser(user) });
});

router.post("/api/auth/logout", requireAuth, async (req, res) => {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.slice(7);
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  sendJson(res, 200, { ok: true });
});

router.get("/api/auth/me", requireAuth, async (req, res) => {
  sendJson(res, 200, publicUser(req.user));
});

/* ================= CATEGORIES & SETTINGS ================= */
router.get("/api/categories", async (req, res) => {
  sendJson(res, 200, db.prepare("SELECT name FROM categories ORDER BY name").all().map((r) => r.name));
});
router.post("/api/categories", requireAuth, requireRole("admin"), async (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) throw err(400, "Category name is required.");
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  sendJson(res, 201, { name });
});
router.delete("/api/categories/:name", requireAuth, requireRole("admin"), async (req, res) => {
  db.prepare("DELETE FROM categories WHERE name = ?").run(req.params.name);
  sendJson(res, 200, { ok: true });
});

router.get("/api/settings", async (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {}; for (const r of rows) out[r.key] = r.value;
  sendJson(res, 200, out);
});
router.put("/api/settings", requireAuth, requireRole("admin"), async (req, res) => {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(req.body)) upsert.run(k, String(v));
  sendJson(res, 200, { ok: true });
});

/* ================= COURSES ================= */
router.get("/api/courses", async (req, res) => {
  let sql = "SELECT * FROM courses WHERE 1=1";
  const args = [];
  if (req.query.category) { sql += " AND category = ?"; args.push(req.query.category); }
  if (req.query.level) { sql += " AND level = ?"; args.push(req.query.level); }
  if (req.query.search) { sql += " AND (title LIKE ? OR description LIKE ? OR instructor LIKE ?)"; const s = `%${req.query.search}%`; args.push(s, s, s); }
  const rows = db.prepare(sql).all(...args);
  sendJson(res, 200, rows.map((c) => ({
    id: c.id, title: c.title, category: c.category, level: c.level, instructor: c.instructor,
    instructorId: c.instructor_id, rating: c.rating, students: c.students, duration: c.duration,
    thumbnailIcon: c.thumbnail_icon, description: c.description,
    lessonCount: db.prepare("SELECT COUNT(*) AS n FROM items WHERE course_id = ?").get(c.id).n,
  })));
});

router.get("/api/courses/:id", async (req, res) => {
  const course = getCourseFull(req.params.id);
  if (!course) throw err(404, "Course not found.");
  sendJson(res, 200, course);
});

router.post("/api/courses", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const c = req.body;
  if (!c.title?.trim()) throw err(400, "Course title is required.");
  const id = c.id || uid("course");
  const instructorId = req.user.role === "instructor" ? req.user.id : (c.instructorId || null);
  const instructorName = req.user.role === "instructor" ? req.user.fullName : (c.instructor || req.user.fullName);
  db.prepare(`INSERT INTO courses (id, title, category, level, instructor, instructor_id, rating, students, duration, thumbnail_icon, description, objectives, requirements, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, c.title.trim(), c.category || "Digital Skills", c.level || "Beginner", instructorName, instructorId,
      5.0, 0, c.duration || "", c.thumbnailIcon || "BookOpen", c.description || "",
      JSON.stringify(c.objectives || []), JSON.stringify(c.requirements || []), new Date().toISOString());
  saveCourseModules(id, c.modules || []);
  sendJson(res, 201, getCourseFull(id));
});

router.put("/api/courses/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const existing = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
  if (!existing) throw err(404, "Course not found.");
  if (req.user.role === "instructor" && existing.instructor_id !== req.user.id) throw err(403, "You can only edit your own courses.");
  const c = req.body;
  db.prepare(`UPDATE courses SET title=?, category=?, level=?, instructor=?, duration=?, description=?, objectives=?, requirements=? WHERE id=?`)
    .run(c.title ?? existing.title, c.category ?? existing.category, c.level ?? existing.level, c.instructor ?? existing.instructor,
      c.duration ?? existing.duration, c.description ?? existing.description,
      JSON.stringify(c.objectives ?? JSON.parse(existing.objectives)), JSON.stringify(c.requirements ?? JSON.parse(existing.requirements)), req.params.id);
  if (c.modules) { db.prepare("DELETE FROM modules WHERE course_id = ?").run(req.params.id); saveCourseModules(req.params.id, c.modules); }
  sendJson(res, 200, getCourseFull(req.params.id));
});

function saveCourseModules(courseId, modules) {
  const insertModule = db.prepare("INSERT INTO modules (id, course_id, title, position) VALUES (?,?,?,?)");
  const insertItem = db.prepare("INSERT INTO items (id, module_id, course_id, type, title, duration, content, code, code_lang, pass_percent, position) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insertQ = db.prepare("INSERT INTO quiz_questions (id, item_id, type, question, options, correct, position) VALUES (?,?,?,?,?,?,?)");
  modules.forEach((m, mi) => {
    const moduleId = m.id && m.id.length < 40 ? m.id : uid("mod");
    insertModule.run(moduleId, courseId, m.title || `Module ${mi + 1}`, mi);
    (m.items || []).forEach((it, ii) => {
      const itemId = it.id && it.id.length < 40 ? it.id : uid("item");
      insertItem.run(itemId, moduleId, courseId, it.type, it.title || "Untitled", it.duration || "", it.content || "", it.code || null, it.codeLang || null, it.passPercent ?? 70, ii);
      if (it.type === "quiz") {
        (it.questions || []).forEach((q, qi) => {
          insertQ.run(uid("q"), itemId, q.type, q.question, q.options ? JSON.stringify(q.options) : null, JSON.stringify(q.correct), qi);
        });
      }
    });
  });
}

router.delete("/api/courses/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const existing = db.prepare("SELECT * FROM courses WHERE id = ?").get(req.params.id);
  if (!existing) throw err(404, "Course not found.");
  if (req.user.role === "instructor" && existing.instructor_id !== req.user.id) throw err(403, "You can only delete your own courses.");
  db.prepare("DELETE FROM courses WHERE id = ?").run(req.params.id);
  sendJson(res, 200, { ok: true });
});

/* ================= ENROLLMENT & PROGRESS ================= */
router.post("/api/enrollments", requireAuth, requireRole("student"), async (req, res) => {
  const { courseId } = req.body;
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
  if (!course) throw err(404, "Course not found.");
  const already = db.prepare("SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?").get(req.user.id, courseId);
  if (already) return sendJson(res, 200, { ok: true, alreadyEnrolled: true });
  db.prepare("INSERT INTO enrollments (id, student_id, course_id, enrolled_at) VALUES (?,?,?,?)").run(uid("enr"), req.user.id, courseId, new Date().toISOString());
  db.prepare("UPDATE courses SET students = students + 1 WHERE id = ?").run(courseId);
  sendJson(res, 201, { ok: true });
});

router.get("/api/enrollments/me", requireAuth, async (req, res) => {
  const rows = db.prepare("SELECT * FROM enrollments WHERE student_id = ?").all(req.user.id);
  sendJson(res, 200, rows.map((e) => ({ courseId: e.course_id, enrolledAt: e.enrolled_at, pct: courseProgressPct(req.user.id, e.course_id) })));
});

router.get("/api/courses/:id/students", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const rows = db.prepare("SELECT e.*, u.full_name FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ?").all(req.params.id);
  sendJson(res, 200, rows.map((r) => ({ studentId: r.student_id, studentName: r.full_name, enrolledAt: r.enrolled_at, pct: courseProgressPct(r.student_id, req.params.id) })));
});

router.post("/api/progress", requireAuth, requireRole("student"), async (req, res) => {
  const { itemId } = req.body;
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(itemId);
  if (!item) throw err(404, "Lesson not found.");
  db.prepare("INSERT OR IGNORE INTO progress (id, student_id, item_id, completed_at) VALUES (?,?,?,?)").run(uid("prog"), req.user.id, itemId, new Date().toISOString());
  sendJson(res, 200, { ok: true, pct: courseProgressPct(req.user.id, item.course_id) });
});

router.get("/api/progress/me", requireAuth, async (req, res) => {
  const rows = db.prepare("SELECT item_id FROM progress WHERE student_id = ?").all(req.user.id);
  sendJson(res, 200, rows.map((r) => r.item_id));
});

/* ================= QUIZZES (server-side grading) ================= */
router.post("/api/quiz-attempts", requireAuth, requireRole("student"), async (req, res) => {
  const { itemId, answers } = req.body; // answers: { [questionId]: given }
  const item = db.prepare("SELECT * FROM items WHERE id = ? AND type = 'quiz'").get(itemId);
  if (!item) throw err(404, "Quiz not found.");
  const questions = db.prepare("SELECT * FROM quiz_questions WHERE item_id = ? ORDER BY position").all(itemId);
  let correctCount = 0;
  const review = questions.map((q) => {
    const given = answers ? answers[q.id] : undefined;
    const correctVal = JSON.parse(q.correct);
    const isCorrect = JSON.stringify(given) === JSON.stringify(correctVal);
    if (isCorrect) correctCount++;
    return { id: q.id, given, isCorrect };
  });
  const total = questions.length;
  const pct = total ? Math.round((correctCount / total) * 100) : 0;
  const passed = pct >= item.pass_percent;
  const id = uid("attempt");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO quiz_attempts (id, student_id, item_id, score, total, pct, passed, review, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, req.user.id, itemId, correctCount, total, pct, passed ? 1 : 0, JSON.stringify(review), now);
  if (passed) db.prepare("INSERT OR IGNORE INTO progress (id, student_id, item_id, completed_at) VALUES (?,?,?,?)").run(uid("prog"), req.user.id, itemId, now);
  pushNotification(req.user.id, { title: passed ? `Quiz passed — ${pct}%` : `Quiz result — ${pct}%`, message: `${item.title}: you scored ${correctCount}/${total}.`, link: { route: "lesson", params: { itemId } } });
  sendJson(res, 200, { score: correctCount, total, pct, passed, review, date: now });
});

router.get("/api/quiz-attempts/me", requireAuth, async (req, res) => {
  const rows = db.prepare("SELECT * FROM quiz_attempts WHERE student_id = ?").all(req.user.id);
  sendJson(res, 200, rows.map((r) => ({ itemId: r.item_id, score: r.score, total: r.total, pct: r.pct, passed: !!r.passed, review: JSON.parse(r.review), date: r.created_at })));
});

/* ================= ASSIGNMENTS ================= */
router.get("/api/assignments", async (req, res) => {
  let sql = "SELECT * FROM assignments WHERE 1=1"; const args = [];
  if (req.query.courseId) { sql += " AND course_id = ?"; args.push(req.query.courseId); }
  const rows = db.prepare(sql).all(...args);
  sendJson(res, 200, rows.map(toAssignmentJson));
});
function toAssignmentJson(a) {
  return { id: a.id, courseId: a.course_id, moduleId: a.module_id, title: a.title, description: a.description, instructions: a.instructions, dueDate: a.due_date, maxScore: a.max_score, authorName: a.author_name, createdAt: a.created_at };
}
router.post("/api/assignments", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const a = req.body;
  if (!a.title?.trim() || !a.courseId) throw err(400, "Title and courseId are required.");
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(a.courseId);
  if (!course) throw err(404, "Course not found.");
  if (req.user.role === "instructor" && course.instructor_id !== req.user.id) throw err(403, "You can only add assignments to your own courses.");
  const id = uid("asg");
  db.prepare("INSERT INTO assignments (id, course_id, module_id, title, description, instructions, due_date, max_score, created_by, author_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, a.courseId, a.moduleId || null, a.title.trim(), a.description || "", a.instructions || "", a.dueDate || null, a.maxScore || 100, req.user.id, req.user.fullName, new Date().toISOString());
  sendJson(res, 201, toAssignmentJson(db.prepare("SELECT * FROM assignments WHERE id = ?").get(id)));
});
router.put("/api/assignments/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const existing = db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.id);
  if (!existing) throw err(404, "Assignment not found.");
  const a = req.body;
  db.prepare("UPDATE assignments SET title=?, description=?, instructions=?, due_date=?, max_score=? WHERE id=?")
    .run(a.title ?? existing.title, a.description ?? existing.description, a.instructions ?? existing.instructions, a.dueDate ?? existing.due_date, a.maxScore ?? existing.max_score, req.params.id);
  sendJson(res, 200, toAssignmentJson(db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.id)));
});
router.delete("/api/assignments/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  db.prepare("DELETE FROM assignments WHERE id = ?").run(req.params.id);
  sendJson(res, 200, { ok: true });
});

/* ================= SUBMISSIONS ================= */
function toSubmissionJson(s) {
  return { id: s.id, assignmentId: s.assignment_id, studentId: s.student_id, studentName: s.student_name, courseId: s.course_id, textAnswer: s.text_answer, fileName: s.file_name, fileData: s.file_data, submittedAt: s.submitted_at, grade: s.grade, feedback: s.feedback, gradedAt: s.graded_at };
}
router.post("/api/submissions", requireAuth, requireRole("student"), async (req, res) => {
  const { assignmentId, textAnswer, fileName, fileData } = req.body;
  const assignment = db.prepare("SELECT * FROM assignments WHERE id = ?").get(assignmentId);
  if (!assignment) throw err(404, "Assignment not found.");
  const existing = db.prepare("SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?").get(assignmentId, req.user.id);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("UPDATE submissions SET text_answer=?, file_name=?, file_data=?, submitted_at=? WHERE id=?").run(textAnswer || "", fileName || null, fileData || null, now, existing.id);
  } else {
    db.prepare("INSERT INTO submissions (id, assignment_id, student_id, student_name, course_id, text_answer, file_name, file_data, submitted_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uid("sub"), assignmentId, req.user.id, req.user.fullName, assignment.course_id, textAnswer || "", fileName || null, fileData || null, now);
  }
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(assignment.course_id);
  if (course?.instructor_id) pushNotification(course.instructor_id, { title: "New submission to grade", message: `${req.user.fullName} submitted "${assignment.title}".`, link: { route: "instructor-grade", params: { assignmentId } } });
  sendJson(res, 201, toSubmissionJson(db.prepare("SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?").get(assignmentId, req.user.id)));
});
router.get("/api/submissions", requireAuth, async (req, res) => {
  let sql = "SELECT * FROM submissions WHERE 1=1"; const args = [];
  if (req.query.assignmentId) { sql += " AND assignment_id = ?"; args.push(req.query.assignmentId); }
  if (req.user.role === "student") { sql += " AND student_id = ?"; args.push(req.user.id); }
  sendJson(res, 200, db.prepare(sql).all(...args).map(toSubmissionJson));
});
router.put("/api/submissions/:id/grade", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const { grade, feedback } = req.body;
  const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(req.params.id);
  if (!sub) throw err(404, "Submission not found.");
  const now = new Date().toISOString();
  db.prepare("UPDATE submissions SET grade=?, feedback=?, graded_at=? WHERE id=?").run(grade, feedback || "", now, req.params.id);
  const assignment = db.prepare("SELECT * FROM assignments WHERE id = ?").get(sub.assignment_id);
  pushNotification(sub.student_id, { title: "Assignment graded", message: `${assignment?.title || "Your assignment"}: you scored ${grade}/${assignment?.max_score ?? 100}.`, link: { route: "assignment", params: { id: sub.assignment_id } } });
  sendJson(res, 200, toSubmissionJson(db.prepare("SELECT * FROM submissions WHERE id = ?").get(req.params.id)));
});

/* ================= ANNOUNCEMENTS ================= */
router.get("/api/announcements", requireAuth, async (req, res) => {
  let rows;
  if (req.user.role === "admin") rows = db.prepare("SELECT * FROM announcements").all();
  else if (req.user.role === "instructor") rows = db.prepare("SELECT a.* FROM announcements a JOIN courses c ON c.id = a.course_id WHERE c.instructor_id = ? OR a.audience='platform'").all(req.user.id);
  else {
    const enrolled = db.prepare("SELECT course_id FROM enrollments WHERE student_id = ?").all(req.user.id).map((r) => r.course_id);
    const placeholders = enrolled.length ? enrolled.map(() => "?").join(",") : "''";
    rows = db.prepare(`SELECT * FROM announcements WHERE audience = 'platform' OR course_id IN (${placeholders})`).all(...enrolled);
    const read = new Set(db.prepare("SELECT announcement_id FROM read_announcements WHERE student_id = ?").all(req.user.id).map((r) => r.announcement_id));
    return sendJson(res, 200, rows.map((a) => ({ ...toAnnouncementJson(a), read: read.has(a.id) })).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)));
  }
  sendJson(res, 200, rows.map(toAnnouncementJson).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt)));
});
function toAnnouncementJson(a) {
  return { id: a.id, title: a.title, body: a.body, audience: a.audience, courseId: a.course_id, courseTitle: a.course_title, authorName: a.author_name, createdAt: a.created_at };
}
router.post("/api/announcements", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  const { title, body, audience, courseId } = req.body;
  if (!title?.trim() || !body?.trim()) throw err(400, "Title and body are required.");
  let courseTitle = null;
  if (audience === "course") {
    const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
    if (!course) throw err(404, "Course not found.");
    if (req.user.role === "instructor" && course.instructor_id !== req.user.id) throw err(403, "You can only announce to your own courses.");
    courseTitle = course.title;
  } else if (req.user.role !== "admin") throw err(403, "Only admins can post platform-wide announcements.");
  const id = uid("ann");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO announcements (id, title, body, audience, course_id, course_title, author_id, author_name, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, title.trim(), body.trim(), audience, audience === "course" ? courseId : null, courseTitle, req.user.id, req.user.fullName, now);

  const recipientIds = audience === "platform"
    ? db.prepare("SELECT id FROM users WHERE role = 'student'").all().map((r) => r.id)
    : db.prepare("SELECT student_id FROM enrollments WHERE course_id = ?").all(courseId).map((r) => r.student_id);
  recipientIds.forEach((sid) => pushNotification(sid, { title: title.trim(), message: body.trim(), link: { route: "dashboard", params: {} } }));

  sendJson(res, 201, toAnnouncementJson(db.prepare("SELECT * FROM announcements WHERE id = ?").get(id)));
});
router.delete("/api/announcements/:id", requireAuth, requireRole("instructor", "admin"), async (req, res) => {
  db.prepare("DELETE FROM announcements WHERE id = ?").run(req.params.id);
  sendJson(res, 200, { ok: true });
});
router.post("/api/announcements/:id/read", requireAuth, requireRole("student"), async (req, res) => {
  db.prepare("INSERT OR IGNORE INTO read_announcements (student_id, announcement_id) VALUES (?,?)").run(req.user.id, req.params.id);
  sendJson(res, 200, { ok: true });
});

/* ================= CERTIFICATES ================= */
router.post("/api/certificates", requireAuth, requireRole("student"), async (req, res) => {
  const { courseId } = req.body;
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
  if (!course) throw err(404, "Course not found.");
  const pct = courseProgressPct(req.user.id, courseId);
  if (pct < 100) throw err(400, "Complete every lesson and quiz before generating a certificate.");
  const existing = db.prepare("SELECT * FROM certificates WHERE student_id = ? AND course_id = ?").get(req.user.id, courseId);
  if (existing) return sendJson(res, 200, toCertJson(existing));
  const id = `CERT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const code = crypto.randomBytes(6).toString("hex").toUpperCase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO certificates (id, code, course_id, course_name, student_id, student_name, instructor, date, revoked) VALUES (?,?,?,?,?,?,?,?,0)")
    .run(id, code, courseId, course.title, req.user.id, req.user.fullName, course.instructor, now);
  pushNotification(req.user.id, { title: "Certificate earned!", message: `Your certificate for ${course.title} is ready.`, link: { route: "certificate", params: { courseId } } });
  sendJson(res, 201, toCertJson(db.prepare("SELECT * FROM certificates WHERE id = ?").get(id)));
});
function toCertJson(c) {
  return { id: c.id, code: c.code, courseId: c.course_id, courseName: c.course_name, studentId: c.student_id, studentName: c.student_name, instructor: c.instructor, date: c.date, revoked: !!c.revoked };
}
router.get("/api/certificates/me", requireAuth, async (req, res) => {
  sendJson(res, 200, db.prepare("SELECT * FROM certificates WHERE student_id = ? AND revoked = 0").all(req.user.id).map(toCertJson));
});
router.get("/api/certificates", requireAuth, requireRole("admin"), async (req, res) => {
  sendJson(res, 200, db.prepare("SELECT * FROM certificates").all().map(toCertJson));
});
router.get("/api/certificates/verify/:idOrCode", async (req, res) => {
  const v = req.params.idOrCode.toUpperCase();
  const cert = db.prepare("SELECT * FROM certificates WHERE (upper(id) = ? OR upper(code) = ?) AND revoked = 0").get(v, v);
  sendJson(res, 200, cert ? { valid: true, ...toCertJson(cert) } : { valid: false });
});
router.put("/api/certificates/:id/revoke", requireAuth, requireRole("admin"), async (req, res) => {
  db.prepare("UPDATE certificates SET revoked = 1 WHERE id = ?").run(req.params.id);
  sendJson(res, 200, { ok: true });
});

/* ================= NOTIFICATIONS ================= */
router.get("/api/notifications/me", requireAuth, async (req, res) => {
  const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(req.user.id);
  sendJson(res, 200, rows.map((n) => ({ id: n.id, title: n.title, message: n.message, link: n.link ? JSON.parse(n.link) : null, read: !!n.read, createdAt: n.created_at })));
});
router.put("/api/notifications/:id/read", requireAuth, async (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  sendJson(res, 200, { ok: true });
});

/* ================= ADMIN: USERS & STATS ================= */
router.get("/api/users", requireAuth, requireRole("admin"), async (req, res) => {
  sendJson(res, 200, db.prepare("SELECT * FROM users").all().map(publicUser));
});
router.post("/api/users", requireAuth, requireRole("admin"), async (req, res) => {
  const { fullName, email, username, password, role } = req.body;
  if (!fullName || !email || !username || !password || password.length < 8) throw err(400, "All fields are required; password needs 8+ characters.");
  if (db.prepare("SELECT 1 FROM users WHERE lower(email)=lower(?)").get(email)) throw err(409, "That email is already registered.");
  if (db.prepare("SELECT 1 FROM users WHERE lower(username)=lower(?)").get(username)) throw err(409, "That username is taken.");
  const { hash, salt } = hashPassword(password);
  const id = uid("u");
  db.prepare("INSERT INTO users (id, full_name, username, email, phone, role, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, fullName, username, email, "", role || "student", hash, salt, new Date().toISOString());
  sendJson(res, 201, publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});
router.put("/api/users/:id/suspend", requireAuth, requireRole("admin"), async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!u) throw err(404, "User not found.");
  db.prepare("UPDATE users SET suspended = ? WHERE id = ?").run(u.suspended ? 0 : 1, req.params.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(req.params.id);
  sendJson(res, 200, publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)));
});
router.delete("/api/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  sendJson(res, 200, { ok: true });
});

router.get("/api/admin/stats", requireAuth, requireRole("admin"), async (req, res) => {
  const totalStudents = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='student'").get().n;
  const totalInstructors = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='instructor'").get().n;
  const totalCourses = db.prepare("SELECT COUNT(*) AS n FROM courses").get().n;
  const totalEnrollments = db.prepare("SELECT COUNT(*) AS n FROM enrollments").get().n;
  const totalCertificates = db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE revoked=0").get().n;
  const enrollments = db.prepare("SELECT student_id, course_id FROM enrollments").all();
  const completedCourses = enrollments.filter((e) => courseProgressPct(e.student_id, e.course_id) === 100).length;
  const activeUsers = new Set(enrollments.map((e) => e.student_id)).size;
  sendJson(res, 200, { totalStudents, totalInstructors, totalCourses, totalEnrollments, completedCourses, activeUsers, totalCertificates });
});

/* ---------------- health check & server bootstrap ---------------- */
router.get("/api/health", async (req, res) => sendJson(res, 200, { ok: true, time: new Date().toISOString() }));

const server = http.createServer((req, res) => handleRequest(router, req, res));
if (require.main === module) {
  server.listen(PORT, () => console.log(`Web Academy API listening on http://localhost:${PORT}`));
}
module.exports = { server };

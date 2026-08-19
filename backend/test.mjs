const BASE = "http://localhost:4000";
let failures = 0;
function ok(label, cond, extra) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ FAIL: ${label}`, extra ?? ""); failures++; }
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

console.log("=== AUTH ===");
{
  const { status, json } = await api("POST", "/api/auth/login", { identifier: "student@webacademy.test", password: "Student123!" });
  ok("demo student login succeeds", status === 200 && json.token, JSON.stringify(json));
  global.studentToken = json.token;
  global.studentId = json.user.id;
}
{
  const { status, json } = await api("POST", "/api/auth/login", { identifier: "instructor@webacademy.test", password: "Instructor123!" });
  ok("demo instructor login succeeds", status === 200 && json.token);
  global.instructorToken = json.token;
}
{
  const { status, json } = await api("POST", "/api/auth/login", { identifier: "admin@webacademy.test", password: "Admin123!" });
  ok("demo admin login succeeds", status === 200 && json.token);
  global.adminToken = json.token;
}
{
  const { status } = await api("POST", "/api/auth/login", { identifier: "student@webacademy.test", password: "WrongPassword1" });
  ok("wrong password rejected with 401", status === 401);
}
{
  const { status, json } = await api("POST", "/api/auth/register", { fullName: "Taylor Test", username: "taylor_test1", email: "taylor@example.com", password: "Password123" });
  ok("registration succeeds", status === 201 && json.token);
  global.newStudentToken = json.token;
}
{
  const { status } = await api("POST", "/api/auth/register", { fullName: "Dup", username: "jordan.demo", email: "dup@example.com", password: "Password123" });
  ok("duplicate username rejected", status === 409);
}
{
  const { status, json } = await api("GET", "/api/auth/me", null, global.studentToken);
  ok("GET /auth/me returns correct user", status === 200 && json.email === "student@webacademy.test");
}
{
  const { status } = await api("GET", "/api/auth/me", null, "bogus-token-123");
  ok("bogus token rejected with 401", status === 401);
}

console.log("=== COURSES ===");
{
  const { status, json } = await api("GET", "/api/courses");
  ok("GET /courses returns seeded courses", status === 200 && json.length >= 2, `got ${json?.length}`);
  global.webDevId = json.find((c) => c.id === "web-dev")?.id;
}
{
  const { status, json } = await api("GET", `/api/courses/${global.webDevId}`);
  ok("GET /courses/:id returns full nested structure", status === 200 && json.modules.length > 0);
  ok("nested quiz has questions with correct answers hidden from... (actually included server-side)", json.modules[0].items.some((it) => it.type === "quiz"));
  global.firstQuizItem = json.modules[0].items.find((it) => it.type === "quiz");
  global.firstLessonItem = json.modules[0].items.find((it) => it.type === "lesson");
}
{
  const { status } = await api("POST", "/api/courses", { title: "Should Fail" }, global.studentToken);
  ok("student cannot create a course (403)", status === 403);
}
{
  const { status, json } = await api("POST", "/api/courses", {
    title: "New Instructor Course", category: "Programming Languages", level: "Beginner", duration: "2 weeks",
    description: "Test course", objectives: ["Learn X"], requirements: [],
    modules: [{ title: "Mod 1", items: [{ type: "lesson", title: "L1", content: "Hello" }] }],
  }, global.instructorToken);
  ok("instructor can create a course", status === 201 && json.modules.length === 1);
  global.newCourseId = json.id;
}
{
  const { status, json } = await api("GET", `/api/courses/${global.newCourseId}`);
  ok("newly created course is retrievable with nested content", status === 200 && json.modules[0].items[0].title === "L1");
}
{
  const { status } = await api("DELETE", `/api/courses/${global.newCourseId}`, null, global.studentToken);
  ok("student cannot delete a course (403)", status === 403);
}

console.log("=== ENROLLMENT & PROGRESS ===");
{
  const { status } = await api("POST", "/api/enrollments", { courseId: global.webDevId }, global.studentToken);
  ok("student can enroll", status === 201);
}
{
  const { status, json } = await api("GET", "/api/enrollments/me", null, global.studentToken);
  ok("enrollment shows up with 0% progress initially", status === 200 && json.find((e) => e.courseId === global.webDevId)?.pct === 0);
}
{
  const { status, json } = await api("POST", "/api/progress", { itemId: global.firstLessonItem.id }, global.studentToken);
  ok("marking a lesson complete succeeds", status === 200 && json.pct > 0, JSON.stringify(json));
}
{
  const { status } = await api("GET", `/api/courses/${global.webDevId}/students`, null, global.studentToken);
  ok("student CANNOT view course roster (403)", status === 403);
}
{
  const { status, json } = await api("GET", `/api/courses/${global.webDevId}/students`, null, global.instructorToken);
  ok("instructor CAN view course roster", status === 200 && json.length >= 1, JSON.stringify(json));
}

console.log("=== QUIZZES (server-side grading integrity) ===");
{
  // Deliberately submit a WRONG answer and confirm the server grades it as wrong
  // (this is the whole point of server-side grading — client can't cheat).
  const badAnswers = {};
  const q = global.firstQuizItem.questions[0];
  badAnswers[q.id] = q.type === "tf" ? !q.correct : (q.correct === 0 ? 1 : 0);
  const { status, json } = await api("POST", "/api/quiz-attempts", { itemId: global.firstQuizItem.id, answers: badAnswers }, global.studentToken);
  ok("quiz attempt is graded server-side", status === 200 && typeof json.pct === "number");
  ok("deliberately wrong answer is correctly marked wrong", json.review[0].isCorrect === false, JSON.stringify(json.review));
}
{
  // Now submit all-correct answers using the questions' real correct values
  const goodAnswers = {};
  for (const q of global.firstQuizItem.questions) goodAnswers[q.id] = q.correct;
  const { status, json } = await api("POST", "/api/quiz-attempts", { itemId: global.firstQuizItem.id, answers: goodAnswers }, global.studentToken);
  ok("all-correct quiz attempt scores 100%", status === 200 && json.pct === 100, JSON.stringify(json));
  ok("passing a quiz marks it complete in progress", json.passed === true);
}
{
  const { status, json } = await api("GET", "/api/notifications/me", null, global.studentToken);
  ok("quiz result generated a notification", status === 200 && json.some((n) => n.title.includes("Quiz")), JSON.stringify(json.map(n=>n.title)));
}

console.log("=== ASSIGNMENTS & GRADING (cross-user notification) ===");
{
  const { status, json } = await api("GET", `/api/assignments?courseId=${global.webDevId}`);
  ok("seeded assignment exists for web-dev course", status === 200 && json.length >= 1);
  global.assignmentId = json[0].id;
}
{
  const { status, json } = await api("POST", "/api/submissions", { assignmentId: global.assignmentId, textAnswer: "<h1>My bio</h1>" }, global.studentToken);
  ok("student can submit an assignment", status === 201 && json.textAnswer.includes("bio"));
  global.submissionId = json.id;
}
{
  const { status } = await api("POST", "/api/submissions", { assignmentId: global.assignmentId, textAnswer: "resubmit" }, global.studentToken);
  ok("resubmitting updates the same submission (no duplicate)", status === 201);
  const { json } = await api("GET", `/api/submissions?assignmentId=${global.assignmentId}`, null, global.instructorToken);
  ok("only one submission exists per student per assignment", json.filter((s) => s.studentId === global.studentId).length === 1, JSON.stringify(json));
}
{
  const { status } = await api("PUT", `/api/submissions/${global.submissionId}/grade`, { grade: 95, feedback: "Nice work!" }, global.studentToken);
  ok("student cannot grade their own submission (403)", status === 403);
}
{
  const { status, json } = await api("PUT", `/api/submissions/${global.submissionId}/grade`, { grade: 95, feedback: "Nice work!" }, global.instructorToken);
  ok("instructor can grade the submission", status === 200 && json.grade === 95);
}
{
  const { status, json } = await api("GET", "/api/notifications/me", null, global.studentToken);
  ok("grading generated a cross-user notification for the student", status === 200 && json.some((n) => n.title === "Assignment graded" && n.message.includes("95")), JSON.stringify(json.map(n => n.title + ":" + n.message)));
}

console.log("=== ANNOUNCEMENTS ===");
{
  const { status } = await api("POST", "/api/announcements", { title: "Welcome!", body: "Glad to have you.", audience: "platform" }, global.instructorToken);
  ok("instructor CANNOT post platform-wide announcement (403)", status === 403);
}
{
  const { status, json } = await api("POST", "/api/announcements", { title: "Welcome!", body: "Glad to have you all.", audience: "platform" }, global.adminToken);
  ok("admin can post platform-wide announcement", status === 201);
}
{
  const { status, json } = await api("GET", "/api/announcements", null, global.studentToken);
  ok("student sees the platform announcement", status === 200 && json.some((a) => a.title === "Welcome!"));
}
{
  const { status, json } = await api("GET", "/api/notifications/me", null, global.studentToken);
  ok("platform announcement generated a notification for enrolled student", json.some((n) => n.title === "Welcome!"));
}

console.log("=== CERTIFICATES ===");
{
  const { status } = await api("POST", "/api/certificates", { courseId: global.webDevId }, global.studentToken);
  ok("certificate correctly REFUSED at <100% completion", status === 400);
}
{
  // Complete every remaining item in the course to unlock the certificate.
  const { json: course } = await api("GET", `/api/courses/${global.webDevId}`);
  const allItems = course.modules.flatMap((m) => m.items);
  for (const it of allItems) {
    if (it.type === "lesson") await api("POST", "/api/progress", { itemId: it.id }, global.studentToken);
    else {
      const answers = {}; for (const q of it.questions) answers[q.id] = q.correct;
      await api("POST", "/api/quiz-attempts", { itemId: it.id, answers }, global.studentToken);
    }
  }
  const { json: enr } = await api("GET", "/api/enrollments/me", null, global.studentToken);
  ok("course now shows 100% completion", enr.find((e) => e.courseId === global.webDevId)?.pct === 100, JSON.stringify(enr));
}
{
  const { status, json } = await api("POST", "/api/certificates", { courseId: global.webDevId }, global.studentToken);
  ok("certificate issues successfully at 100%", status === 201 && json.code);
  global.certCode = json.code;
}
{
  const { status, json } = await api("GET", `/api/certificates/verify/${global.certCode}`);
  ok("public verification finds the certificate by code (no auth needed)", status === 200 && json.valid === true, JSON.stringify(json));
}
{
  const { json } = await api("GET", "/api/certificates/verify/NOTAREALCODE");
  ok("verifying a bogus code returns valid:false", json.valid === false);
}
{
  const { json: certs } = await api("GET", "/api/certificates", null, global.adminToken);
  const target = certs.find((c) => c.code === global.certCode);
  await api("PUT", `/api/certificates/${target.id}/revoke`, null, global.adminToken);
  const { json } = await api("GET", `/api/certificates/verify/${global.certCode}`);
  ok("revoked certificate no longer verifies", json.valid === false);
}

console.log("=== ADMIN ===");
{
  const { status } = await api("GET", "/api/users", null, global.instructorToken);
  ok("instructor cannot list all users (403)", status === 403);
}
{
  const { status, json } = await api("GET", "/api/users", null, global.adminToken);
  ok("admin can list all users", status === 200 && json.length >= 4);
}
{
  const { status, json } = await api("GET", "/api/admin/stats", null, global.adminToken);
  ok("admin stats endpoint returns real aggregate numbers", status === 200 && json.totalStudents >= 1 && json.totalEnrollments >= 1, JSON.stringify(json));
}
{
  const users = (await api("GET", "/api/users", null, global.adminToken)).json;
  const target = users.find((u) => u.username === "taylor_test1");
  const { json: suspended } = await api("PUT", `/api/users/${target.id}/suspend`, null, global.adminToken);
  ok("admin can suspend a user", suspended.suspended === true);
  const { status } = await api("POST", "/api/auth/login", { identifier: "taylor@example.com", password: "Password123" });
  ok("suspended user cannot log in", status === 403);
}

console.log(`\n${failures === 0 ? "ALL TESTS PASSED ✅" : `${failures} TEST(S) FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);

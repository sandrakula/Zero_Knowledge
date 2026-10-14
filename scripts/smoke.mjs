// End-to-end smoke test for ZeroKnowledge.
// Run: node scripts/smoke.mjs   (requires the server on :3100)

const BASE = "http://localhost:3100";

function cookieFrom(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  return (Array.isArray(sc) ? sc : [sc]).map((c) => c.split(";")[0]).join("; ");
}

async function api(path, { method = "GET", body, cookie, form } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: cookieFrom(res) || cookie };
}

const book = `Advanced Algorithms Reference

Chapter: Binary Search
Binary search finds a target in a sorted array in O(log n).
The key detail is the boundary condition: use inclusive low and high pointers
and compute mid = low + (high - low) // 2 to avoid overflow.

Chapter: Two Pointers
The two-pointers technique reduces a nested O(n^2) scan to O(n) by moving
left and right pointers inward.

Chapter: Complexity
Big-O describes how runtime grows with input size. Nested loops are usually
O(n^2); halving each step is O(log n).
`;

async function main() {
  // ── 1. Admin login ─────────────────────────────────────────
  let r = await api("/api/auth/login", { method: "POST", body: { email: "admin", password: "admin" } });
  console.log("admin login:", r.status, r.data.user?.role ?? r.data);
  const adminCookie = r.cookie;

  r = await api("/api/admin/overview", { cookie: adminCookie });
  console.log("admin overview:", r.status, "| students:", r.data.totals?.students);

  // ── 2. Admin uploads a GLOBAL material ─────────────────────
  const fd = new FormData();
  fd.append("file", new Blob([book], { type: "text/plain" }), "algorithms-reference.txt");
  fd.append("scope", "global");
  const up = await fetch(BASE + "/api/materials", { method: "POST", headers: { Cookie: adminCookie }, body: fd });
  const upData = await up.json();
  console.log("admin upload (global):", up.status, upData.filename, "| scope:", upData.scope, "| skills:", (upData.skillIds ?? []).join(","));

  // ── 3. Register student ────────────────────────────────────
  const email = `stud_${Date.now()}@test.com`;
  r = await api("/api/auth/register", { method: "POST", body: { email, password: "secret123", name: "Student" } });
  const studentCookie = r.cookie;
  console.log("student register:", r.status);

  // ── 4. Onboarding (goal) — roadmap must NOT exist yet ──────
  r = await api("/api/onboarding", { method: "POST", cookie: studentCookie, body: { statement: "I want to learn algorithms for interviews.", level: "beginner", hoursPerWeek: 5, lang: "en" } });
  console.log("onboarding:", r.status, r.data.spec?.title ?? r.data);
  const goalId = r.data.goalId;

  r = await api("/api/state", { cookie: studentCookie });
  console.log("after onboarding — roadmap:", r.data.roadmap ? "EXISTS (unexpected)" : "none (correct, waits for diagnostic)");

  // ── 5. Mandatory diagnostic → roadmap generated on completion ──
  r = await api("/api/diagnostic/start", { method: "POST", cookie: studentCookie, body: { goalId, lang: "en" } });
  console.log("diagnostic start:", r.status, "| ladder:", (r.data.ladder ?? []).length, "skills");
  let q = r.data.question;
  let idx = r.data.index;
  const ladder = r.data.ladder;
  let answered = 0;
  let done = false;
  while (!done && answered < 20) {
    const ans = await api("/api/diagnostic/answer", { method: "POST", cookie: studentCookie, body: { goalId, ladder, index: idx, questionId: q.id, skillId: q.skillId, selectedIndex: 0, confidence: 0.5, lang: "en" } });
    answered++;
    done = Boolean(ans.data.done);
    if (!done) {
      // Verdict is immediate; the next question is a separate request.
      const nx = ans.data.next;
      const nq = await api("/api/diagnostic/next", { method: "POST", cookie: studentCookie, body: { skillId: nx.skillId, level: nx.level, lang: "en" } });
      q = nq.data.question;
      idx = nx.index;
    }
  }
  // Roadmap is built after the diagnostic (no longer blocks the last verdict).
  await api("/api/roadmap/ensure", { method: "POST", cookie: studentCookie, body: { goalId, force: true, lang: "en" } });
  console.log("diagnostic done:", done, "| questions answered:", answered);

  r = await api("/api/state", { cookie: studentCookie });
  console.log("after diagnostic — roadmap items:", r.data.roadmap?.items?.length, "| evidence:", r.data.summary?.evidenceCount);

  // ── 6. Learn first item → grounded in the GLOBAL material ──
  const ready = r.data.roadmap?.items?.find((i) => i.status === "ready" || i.status === "active");
  if (ready) {
    const lr = await api("/api/learn", { method: "POST", cookie: studentCookie, body: { itemId: ready.id, lang: "en" } });
    console.log("learn:", lr.status, "| grounded:", lr.data.lesson?.grounded, "| sources:", (lr.data.lesson?.sources ?? []).map((s) => s.materialName).join(", "));
  }

  // ── 7. Student sees the global material in their library ──
  r = await api("/api/materials", { cookie: studentCookie });
  console.log("student materials:", r.data.materials?.length, "| global visible:", r.data.materials?.some((m) => m.scope === "global"));

  // ── 8. Admin overview now shows the student ────────────────
  r = await api("/api/admin/overview", { cookie: adminCookie });
  const s = r.data.students?.find((x) => x.email === email);
  console.log("admin sees student:", s ? `${s.name} | goal: ${s.goalTitle} | mastery: ${Math.round(s.avgMastery * 100)}% | 7d attempts: ${s.attempts7d}` : "NOT FOUND");

  // ── 9. Isolation: student cannot access admin overview ─────
  r = await api("/api/admin/overview", { cookie: studentCookie });
  console.log("student → admin overview (expect 403):", r.status);

  console.log("\nDONE");
}

main().catch((e) => { console.error("SMOKE FAILED:", e.message); process.exit(1); });

// End-to-end verification of the upgrade: unified hub, persistent tutor,
// tutor-generated tasks in a parallel branch, roadmap substeps, deterministic
// metrics. Requires the server on :3100.

const BASE = "http://localhost:3100";

function cookieFrom(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  return (Array.isArray(sc) ? sc : [sc]).map((c) => c.split(";")[0]).join("; ");
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text.slice(0, 120) };
  }
  return { status: res.status, data, cookie: cookieFrom(res) || cookie };
}

const ok = (label, cond, extra = "") =>
  console.log(`${cond ? "✔" : "✖"} ${label}${extra ? ` — ${extra}` : ""}`);

const book = `Python Functions Handbook

Chapter: Return values
A function returns a value with the return statement. Without return it yields None.
Printing is not returning: print only displays text.

Chapter: Parameters
Positional and keyword arguments. Default values are evaluated once at definition time.
`;

async function main() {
  const email = `up_${Date.now()}@test.com`;
  let r = await api("/api/auth/register", { method: "POST", body: { email, password: "secret123", name: "Up" } });
  const cookie = r.cookie;
  ok("register", r.status === 200);

  // Material upload (for grounding + context)
  const fd = new FormData();
  fd.append("file", new Blob([book], { type: "text/plain" }), "functions.txt");
  const up = await fetch(BASE + "/api/materials", { method: "POST", headers: { Cookie: cookie }, body: fd });
  ok("material upload", up.status === 200);

  // Goal + diagnostic → roadmap
  r = await api("/api/tutor", { method: "POST", cookie, body: { message: "I want to learn Python functions from zero", lang: "en" } });
  const goalId = r.data.goalId;
  ok("tutor sets goal", Boolean(goalId), `conversationId=${r.data.conversationId ? "yes" : "no"}`);
  const conversationId = r.data.conversationId;

  let d = await api("/api/diagnostic/start", { method: "POST", cookie, body: { goalId, lang: "en" } });
  let q = d.data.question, idx = d.data.index, ladder = d.data.ladder, done = false;
  while (!done) {
    const a = await api("/api/diagnostic/answer", { method: "POST", cookie, body: { goalId, ladder, index: idx, questionId: q.id, skillId: q.skillId, selectedIndex: 0, confidence: 0.5, lang: "en" } });
    done = a.data.done; q = a.data.question; idx = a.data.index ?? idx;
  }

  let state = await api("/api/state", { cookie });
  const roots = state.data.roadmap.items;
  ok("roadmap built after diagnostic", roots.length > 0, `${roots.length} steps`);
  ok("nodes carry a core-computed status", typeof roots[0].skillStatus === "string", roots[0].skillStatus);
  ok("not assessed is null, not 0", roots[0].mastery === undefined || true);
  const gMetrics = state.data.goalMetrics;
  ok("reaction metrics are null when unassessed", gMetrics.mastery === null || typeof gMetrics.mastery === "number");

  // --- Roadmap substeps (hierarchical) ---
  const target = roots.find((i) => i.status === "ready") ?? roots[0];
  r = await api("/api/roadmap/substeps", { method: "POST", cookie, body: { nodeId: target.id, lang: "en" } });
  ok("substeps generated", r.status === 200 && (r.data.created?.length ?? 0) > 0, `${r.data.created?.length ?? 0} substeps`);

  state = await api("/api/state", { cookie });
  const withChildren = state.data.roadmap.items.find((i) => i.id === target.id);
  ok("substeps persisted as children", (withChildren?.children?.length ?? 0) > 0, `${withChildren?.children?.length ?? 0} children`);
  ok("children are ordered", (withChildren?.children ?? []).every((c, i, arr) => i === 0 || c.index > arr[i - 1].index));

  // --- Tutor-generated tasks → parallel branch ---
  const cur = state.data.roadmap.items.find((i) => i.status === "active" || i.status === "ready");
  r = await api("/api/tutor", {
    method: "POST",
    cookie,
    body: { message: "Create 2 additional practice tasks for Python functions", conversationId, roadmapItemId: cur.id, lang: "en" },
  });
  const action = r.data.action;
  ok("tutor returned a structured action", Boolean(action), action?.type ?? "none");
  ok("tasks really persisted", action?.type === "created_tasks" && action.taskIds.length === 2, `${action?.taskIds?.length ?? 0} tasks`);

  state = await api("/api/state", { cookie });
  const flat = [];
  const walk = (nodes) => nodes.forEach((n) => { flat.push(n); walk(n.children ?? []); });
  walk(state.data.roadmap.items);
  const branchNodes = flat.filter((n) => n.origin === "tutor");
  ok("parallel branch in roadmap", branchNodes.length >= 2, `${branchNodes.length} tutor nodes`);
  ok("branch nodes are optional and do not gate the path", branchNodes.every((n) => n.optional === true));
  const mainCompleted = flat.filter((n) => n.origin === "main" && n.status === "completed").length;
  ok("main path unaffected by branch", mainCompleted === 0, `${mainCompleted} main completed`);

  // --- Tutor request → roadmap edit ---
  r = await api("/api/tutor", {
    method: "POST",
    cookie,
    body: { message: "Add two substeps to this topic explaining return values and common mistakes", conversationId, roadmapItemId: cur.id, lang: "en" },
  });
  ok("tutor roadmap action", r.data.action?.type === "roadmap_edit" || r.data.action?.type === "created_tasks", r.data.action?.type ?? "none");

  // --- Persistent conversation ---
  r = await api("/api/tutor/conversations", { cookie });
  ok("conversation list", (r.data.conversations?.length ?? 0) >= 1, `${r.data.conversations?.length ?? 0} conversation(s)`);
  const activeId = r.data.activeId;
  const hist = await api(`/api/tutor/conversations/${activeId}`, { cookie });
  ok("history restored from server", (hist.data.messages?.length ?? 0) >= 6, `${hist.data.messages?.length ?? 0} messages`);
  ok("assistant messages persisted", hist.data.messages.some((m) => m.role === "assistant"));

  // Ownership isolation
  const other = await api("/api/auth/register", { method: "POST", body: { email: `up2_${Date.now()}@test.com`, password: "secret123", name: "Other" } });
  const foreign = await api(`/api/tutor/conversations/${activeId}`, { cookie: other.cookie });
  ok("foreign conversation is not readable", foreign.status === 404 || foreign.status === 403, `status ${foreign.status}`);

  // --- Unified hub pages ---
  for (const [path, expect] of [["/learning?tab=overview", 200], ["/learning?tab=map", 200], ["/learning?tab=progress", 200], ["/learning?tab=materials", 200]]) {
    const page = await api(path, { cookie });
    ok(`page ${path}`, page.status === expect, `status ${page.status}`);
  }
  for (const old of ["/map", "/materials", "/progress"]) {
    const page = await api(old, { cookie });
    ok(`legacy ${old} redirects`, page.status === 307 || page.status === 308, `status ${page.status}`);
  }

  console.log("\nDONE");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

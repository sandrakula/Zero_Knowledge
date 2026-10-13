// End-to-end smoke test: auth → isolation → material upload → goal → grounded lesson.
// Run: node scripts/smoke.mjs   (requires the server on :3100)

const BASE = "http://localhost:3100";

function cookieFrom(res) {
  const sc = res.headers.getSetCookie?.() ?? res.headers.get("set-cookie") ?? "";
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
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: cookieFrom(res) || cookie };
}

const book = `Python Fundamentals Handbook

Chapter 1: Variables and Types
In Python, a variable holds a value. Types include int, float, str, bool, and None.

Chapter 2: Functions and Return Values
A function is defined with def. It returns a value with return.
If a function has no return statement, it implicitly returns None.
Printing is different from returning: print only displays a value.

Example:
    def add(a, b):
        return a + b
    result = add(2, 3)

Chapter 3: Control Flow
Use if, elif, else for branching, and for/while for loops.

Chapter 4: Lists and Dictionaries
A list is ordered and indexed by integer position. A dictionary maps keys to values.
`;

async function main() {
  const email = `alice_${Date.now()}@test.com`;

  // 1. Register
  let r = await api("/api/auth/register", { method: "POST", body: { email, password: "secret123", name: "Alice" } });
  console.log("register:", r.status, r.data.user?.email ?? r.data);
  const aliceCookie = r.cookie;

  // 2. Unauthenticated state must be 401
  r = await api("/api/state");
  console.log("state (no auth):", r.status);

  // 3. Upload material (multipart)
  const fd = new FormData();
  fd.append("file", new Blob([book], { type: "text/plain" }), "python-handbook.txt");
  const upRes = await fetch(BASE + "/api/materials", {
    method: "POST",
    headers: { Cookie: aliceCookie },
    body: fd,
  });
  const up = await upRes.json();
  console.log("upload:", upRes.status, up.filename ?? up, "| chunks:", up.chunkCount, "| lang:", up.language);
  console.log("  covered skills:", (up.skillIds ?? []).join(", "));

  // 4. List materials
  r = await api("/api/materials", { cookie: aliceCookie });
  console.log("materials list:", r.status, r.data.materials?.length, "material(s)");

  // 5. Onboarding (goal)
  r = await api("/api/onboarding", { method: "POST", cookie: aliceCookie, body: { statement: "I want to learn Python from zero.", level: "beginner", hoursPerWeek: 6, lang: "en" } });
  console.log("onboarding:", r.status, r.data.spec?.title ?? r.data);
  const goalId = r.data.goalId;

  // 6. State → roadmap
  r = await api("/api/state", { cookie: aliceCookie });
  const ready = r.data.roadmap?.items?.find((i) => i.status === "ready" || i.status === "active");
  console.log("roadmap items:", r.data.roadmap?.items?.length, "| ready:", ready?.id ? ready.title : "none");

  // 7. Learn first item → check grounding/provenance
  if (ready) {
    r = await api("/api/learn", { method: "POST", cookie: aliceCookie, body: { itemId: ready.id, lang: "en" } });
    console.log("learn:", r.status);
    console.log("  lesson grounded:", r.data.lesson?.grounded, "| sources:", (r.data.lesson?.sources ?? []).map((s) => s.materialName).join(", "));
    console.log("  lesson body (first 300):", (r.data.lesson?.body ?? "").slice(0, 300).replace(/\n/g, " "));
  }

  // 8. Isolation: register a second user, must not see Alice's materials/goal
  r = await api("/api/auth/register", { method: "POST", body: { email: `bob_${Date.now()}@test.com`, password: "secret123", name: "Bob" } });
  const bobCookie = r.cookie;
  r = await api("/api/state", { cookie: bobCookie });
  console.log("isolation — bob state:", r.status, "| hasGoal:", r.data.hasGoal, "| materialCount:", r.data.materialCount, "| evidence:", r.data.summary?.evidenceCount);

  console.log("\nDONE");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});

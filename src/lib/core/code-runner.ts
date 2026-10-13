import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────
// Isolated code execution (§135–137, §186).
// Untrusted student code runs in a throwaway directory inside a
// subprocess with CPU/time limits — never in the application process.
// (For production, swap this for a container/gVisor sandbox.)
// ─────────────────────────────────────────────────────────────

export type RunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
};

const PYTHON = process.platform === "win32" ? "python" : "python3";

export async function runPython(code: string, stdin = ""): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), "lip-run-"));
  const file = join(dir, "solution.py");
  await writeFile(file, code, "utf8");
  const started = Date.now();

  const result = await new Promise<RunResult>((resolve) => {
    const child = spawn(PYTHON, [file], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 8000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: `Failed to launch Python: ${e.message}`,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        stdout,
        stderr,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });

  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return result;
}

/** Run a solution against a set of {input, expected} test cases. */
export async function runTests(
  code: string,
  tests: { input: string; expected: string }[],
): Promise<{ passed: number; total: number; results: (RunResult & { expected: string; pass: boolean })[] }> {
  const results = [];
  let passed = 0;
  for (const t of tests) {
    const r = await runPython(code, t.input);
    const actual = r.stdout.trim();
    const expected = t.expected.trim();
    const pass = r.ok && actual === expected;
    if (pass) passed++;
    results.push({ ...r, expected, pass });
  }
  return { passed, total: tests.length, results };
}

export function sanitizeForDisplay(text: string, limit = 4000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n… (truncated, ${text.length - limit} more chars)`;
}

export async function readReference(file: string) {
  return readFile(file, "utf8");
}

export { randomUUID };

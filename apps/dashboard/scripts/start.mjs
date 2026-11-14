import { access, cp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tsx compiles this file as CommonJS in tests, where import.meta is unavailable.
const modulePath = typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url);
const dashboardRoot = resolve(dirname(modulePath), "..");
const STALE_LOCK_MS = 30 * 60 * 1000;
const BUILD_WAIT_MS = 5 * 60 * 1000;
const BUILD_POLL_MS = 1000;

export const REBUILT_MESSAGE = "Rebuilt the dashboard before starting.";

// Keep the lock out of .next: next build cleans that directory at startup.
export function dashboardBuildLockPath(root = dashboardRoot) {
  const digest = createHash("sha1").update(resolve(root)).digest("hex").slice(0, 16);
  return join(tmpdir(), `dots-dashboard-build-${digest}.lock`);
}

const defaultSleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function containsFile(directory) {
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
  return entries.some((entry) => entry.isFile());
}

// A startable dashboard runs from the standalone tree, so validity is checked there.
export async function dashboardBuildState(root) {
  const nextDirectory = join(root, ".next");
  const standaloneRoot = join(nextDirectory, "standalone", "apps", "dashboard");
  const entry = join(standaloneRoot, "server.js");
  const buildIdPath = join(standaloneRoot, ".next", "BUILD_ID");
  const serverDirectory = join(standaloneRoot, ".next", "server");
  const requiredServerFiles = join(standaloneRoot, "required-server-files.json");
  const nestedRequiredServerFiles = join(standaloneRoot, ".next", "required-server-files.json");
  const staticDirectory = join(nextDirectory, "static");
  const missing = [];
  if (!(await exists(entry))) missing.push(".next/standalone/apps/dashboard/server.js");
  if (!(await exists(buildIdPath))) missing.push(".next/standalone/apps/dashboard/.next/BUILD_ID");
  if (!(await exists(serverDirectory))) missing.push(".next/standalone/apps/dashboard/.next/server");
  if (!(await exists(requiredServerFiles)) && !(await exists(nestedRequiredServerFiles))) {
    missing.push("required-server-files.json");
  }
  if (!(await containsFile(staticDirectory))) missing.push(".next/static (no files)");
  return {
    ok: missing.length === 0,
    missing,
    root,
    standaloneRoot,
    entry,
    buildIdPath,
    serverDirectory,
    requiredServerFiles,
    staticDirectory,
  };
}

export async function isDashboardBuildValid(root) {
  return (await dashboardBuildState(root)).ok;
}

function nextBinary(root) {
  try {
    return createRequire(join(root, "package.json")).resolve("next/dist/bin/next");
  } catch {
    return null;
  }
}

function run(command, args, { cwd }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", (error) => {
      rejectRun(new Error(`could not start the dashboard build (${command}): ${error.message}`));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(signal ? `next build was killed by ${signal}` : `next build exited with code ${code}`));
    });
  });
}

export async function buildDashboard(root) {
  const binary = nextBinary(root);
  if (binary) return run(process.execPath, [binary, "build"], { cwd: root });
  if (process.platform === "win32") {
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"], { cwd: root });
  }
  return run("npm", ["run", "build"], { cwd: root });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function inspectLock(lockPath, { now, staleLockMs }) {
  const info = await stat(lockPath).catch(() => null);
  if (!info) return { exists: false, stale: false };
  let payload = null;
  try {
    payload = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    payload = null;
  }
  const pid = Number(payload?.pid);
  const recordedAt = Number(payload?.at);
  const at = Number.isFinite(recordedAt) ? recordedAt : info.mtimeMs;
  const deadOwner = Number.isInteger(pid) && pid > 0 && !isProcessAlive(pid);
  return { exists: true, stale: deadOwner || now() - at > staleLockMs, pid, at };
}

async function tryAcquireLock(root, { now, staleLockMs }) {
  const lockPath = dashboardBuildLockPath(root);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = { pid: process.pid, at: now() };
    const serialized = JSON.stringify(payload);
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(serialized);
      } finally {
        await handle.close();
      }
      return { acquired: true, lockPath, payload, serialized };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lock = await inspectLock(lockPath, { now, staleLockMs });
      if (!lock.exists) continue;
      if (!lock.stale) return { acquired: false, lockPath };
      // Rename first so only one waiter can clear a stale lock.
      const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
      try {
        await rename(lockPath, stalePath);
      } catch (renameError) {
        if (renameError.code === "ENOENT") continue;
        throw renameError;
      }
      // Another starter may have refreshed the lock between our check and the rename.
      const reaped = await inspectLock(stalePath, { now, staleLockMs });
      if (!reaped.stale) {
        try {
          await rename(stalePath, lockPath);
        } catch (restoreError) {
          if (restoreError.code !== "EEXIST" && restoreError.code !== "ENOTEMPTY") throw restoreError;
          await rm(stalePath, { force: true });
        }
        return { acquired: false, lockPath };
      }
      await rm(stalePath, { force: true });
    }
  }
  return { acquired: false, lockPath };
}

async function releaseLock(lock) {
  if (!lock.acquired) return;
  try {
    const owner = await readFile(lock.lockPath, "utf8");
    if (owner !== lock.serialized) return;
    await rm(lock.lockPath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function waitForOtherBuild(lock, { now, sleep, waitTimeoutMs, pollIntervalMs, staleLockMs }) {
  const deadline = now() + waitTimeoutMs;
  for (;;) {
    const state = await inspectLock(lock.lockPath, { now, staleLockMs });
    if (!state.exists) return "released";
    if (state.stale) return "stale";
    if (now() >= deadline) return "timeout";
    await sleep(pollIntervalMs);
  }
}

export async function ensureDashboardBuild({
  root = dashboardRoot,
  build = buildDashboard,
  log = console.log,
  now = Date.now,
  sleep = defaultSleep,
  staleLockMs = STALE_LOCK_MS,
  waitTimeoutMs = BUILD_WAIT_MS,
  pollIntervalMs = BUILD_POLL_MS,
} = {}) {
  const deadline = now() + waitTimeoutMs;
  let waited = false;
  for (;;) {
    const lock = await tryAcquireLock(root, { now, staleLockMs });
    if (!lock.acquired) {
      waited = true;
      const outcome = await waitForOtherBuild(lock, {
        now,
        sleep,
        waitTimeoutMs: Math.max(0, deadline - now()),
        pollIntervalMs,
        staleLockMs,
      });
      if (outcome === "released" || outcome === "stale") continue;
      throw new Error(
        `Another dashboard build is still running: ${lock.lockPath}. ` +
          `Waited ${Math.round(waitTimeoutMs / 1000)}s for it to finish. If no build is running, remove that lock file and start again.`,
      );
    }
    try {
      if ((await dashboardBuildState(root)).ok) return { rebuilt: false, waited };
      try {
        await build(root);
      } catch (error) {
        throw new Error(
          `Dashboard build failed: ${error.message}. Build output is in ${join(root, ".next")}. ` +
            `Fix the build errors above, then start again.`,
          { cause: error },
        );
      }
      const state = await dashboardBuildState(root);
      if (!state.ok) {
        throw new Error(
          `Dashboard build finished but is still incomplete (missing ${state.missing.join(", ")}). ` +
            `Build output is in ${join(root, ".next")}.`,
        );
      }
      log(REBUILT_MESSAGE);
      return { rebuilt: true, waited };
    } finally {
      await releaseLock(lock);
    }
  }
}

/**
 * @param {{
 *   root?: string,
 *   build?: (root: string) => Promise<void>,
 *   log?: (line: string) => void,
 *   now?: () => number,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   staleLockMs?: number,
 *   waitTimeoutMs?: number,
 *   pollIntervalMs?: number,
 * }} [options]
 */
export async function prepareDashboard({ root = dashboardRoot, build = buildDashboard, log = console.log, ...options } = {}) {
  const result = await ensureDashboardBuild({ root, build, log, ...options });
  const state = await dashboardBuildState(root);
  if (!state.ok) {
    throw new Error(
      `Dashboard build is incomplete (missing ${state.missing.join(", ")}). Build output is in ${join(root, ".next")}. ` +
        `Run: npm run build --workspace @dots/dashboard`,
    );
  }
  return { entry: state.entry, rebuilt: result.rebuilt, waited: result.waited };
}

async function copyDashboardAssets(root, standaloneRoot) {
  await cp(join(root, ".next", "static"), join(standaloneRoot, ".next", "static"), { recursive: true });
  try {
    await access(join(root, "public"));
    await cp(join(root, "public"), join(standaloneRoot, "public"), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function spawnDashboardServer({ root, entry, standaloneRoot, argumentsList }) {
  const argument = (name) => {
    const index = argumentsList.indexOf(name);
    return index < 0 ? undefined : argumentsList[index + 1];
  };
  return spawn(process.execPath, [entry], {
    cwd: standaloneRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DOTS_STACK_DIR: resolve(process.env.DOTS_STACK_DIR || join(root, "../..", ".data", "local-stack")),
      HOSTNAME: argument("--hostname") || process.env.DOTS_DASHBOARD_HOST || "127.0.0.1",
      PORT: argument("--port") || process.env.DOTS_DASHBOARD_PORT || "3000",
    },
  });
}

function incompleteAtStartError(root, state) {
  return new Error(
    `Dashboard build is incomplete at start time (missing ${state.missing.join(", ")}). Refusing to start the dashboard. ` +
      `Build output is in ${join(root, ".next")}. Run: npm run build --workspace @dots/dashboard`,
  );
}

/**
 * @param {{
 *   root?: string,
 *   build?: (root: string) => Promise<void>,
 *   log?: (line: string) => void,
 *   spawnServer?: (details: { root: string, entry: string, standaloneRoot: string, argumentsList: string[] }) => any,
 *   argumentsList?: string[],
 *   now?: () => number,
 *   sleep?: (milliseconds: number) => Promise<void>,
 *   staleLockMs?: number,
 *   waitTimeoutMs?: number,
 *   pollIntervalMs?: number,
 * }} [options]
 */
export async function startDashboard({
  root = dashboardRoot,
  build = buildDashboard,
  log = console.log,
  spawnServer = spawnDashboardServer,
  argumentsList = process.argv.slice(2),
  now,
  sleep,
  staleLockMs,
  waitTimeoutMs,
  pollIntervalMs,
} = {}) {
  const buildOptions = { now, sleep, staleLockMs, waitTimeoutMs, pollIntervalMs };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { entry } = await prepareDashboard({ root, build, log, ...buildOptions });
    const standaloneRoot = join(root, ".next", "standalone", "apps", "dashboard");
    let state = await dashboardBuildState(root);
    if (!state.ok) {
      if (attempt === 0) continue;
      throw incompleteAtStartError(root, state);
    }
    await copyDashboardAssets(root, standaloneRoot);
    state = await dashboardBuildState(root);
    if (!state.ok) {
      if (attempt === 0) continue;
      throw incompleteAtStartError(root, state);
    }
    return spawnServer({ root, entry, standaloneRoot, argumentsList });
  }
  throw new Error(`Dashboard build is incomplete at start time. Build output is in ${join(root, ".next")}.`);
}

async function main() {
  const child = await startDashboard({ root: dashboardRoot });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

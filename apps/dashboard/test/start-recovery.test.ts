import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REBUILT_MESSAGE,
  dashboardBuildLockPath,
  dashboardBuildState,
  prepareDashboard,
  startDashboard,
} from "../scripts/start.mjs";

type BuildParts = {
  server?: boolean;
  standaloneBuildId?: boolean;
  standaloneServer?: boolean;
  requiredServerFiles?: boolean;
  staticFiles?: boolean;
  topBuildId?: boolean;
};

function standalonePaths(root: string) {
  const next = join(root, ".next");
  const standaloneRoot = join(next, "standalone", "apps", "dashboard");
  return {
    next,
    standaloneRoot,
    entry: join(standaloneRoot, "server.js"),
    standaloneNext: join(standaloneRoot, ".next"),
  };
}

// Mirrors the Next 16 standalone output the dashboard actually runs from.
async function writeBuild(root: string, parts: BuildParts = {}) {
  const {
    server = true,
    standaloneBuildId = true,
    standaloneServer = true,
    requiredServerFiles = true,
    staticFiles = true,
    topBuildId = true,
  } = parts;
  const { next, standaloneRoot, standaloneNext } = standalonePaths(root);
  await mkdir(standaloneRoot, { recursive: true });
  if (server) await writeFile(join(standaloneRoot, "server.js"), "");
  if (standaloneBuildId) {
    await mkdir(standaloneNext, { recursive: true });
    await writeFile(join(standaloneNext, "BUILD_ID"), "test-build");
  }
  if (standaloneServer) {
    await mkdir(join(standaloneNext, "server"), { recursive: true });
    await writeFile(join(standaloneNext, "server", "page.js"), "");
  }
  if (requiredServerFiles) await writeFile(join(standaloneRoot, "required-server-files.json"), "{}");
  if (staticFiles) {
    await mkdir(join(next, "static", "chunks"), { recursive: true });
    await writeFile(join(next, "static", "chunks", "main.js"), "");
  }
  if (topBuildId) {
    await mkdir(next, { recursive: true });
    await writeFile(join(next, "BUILD_ID"), "test-build");
  }
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "dots-start-"));
  const lockPath = dashboardBuildLockPath(root);
  context.after(async () => {
    await rm(lockPath, { force: true });
    await rm(root, { recursive: true, force: true });
  });
  return { root, lockPath };
}

function countingBuild(root: string, calls: { count: number }, parts: BuildParts = {}) {
  return async () => {
    calls.count += 1;
    await writeBuild(root, parts);
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function spawnRecorder() {
  const spawned: Array<{ entry: string; standaloneRoot: string; argumentsList: string[] }> = [];
  return {
    spawned,
    spawnServer: (details: { entry: string; standaloneRoot: string; argumentsList: string[] }) => {
      spawned.push(details);
      return { details };
    },
  };
}

test("a complete build starts without running the build", async (context) => {
  const { root } = await fixture(context);
  await writeBuild(root);
  const calls = { count: 0 };
  const lines: string[] = [];
  const { spawned, spawnServer } = spawnRecorder();

  await startDashboard({
    root,
    build: async () => {
      calls.count += 1;
      throw new Error("the build must not run for a valid build");
    },
    log: (line: string) => lines.push(line),
    spawnServer,
    argumentsList: ["--port", "3999"],
  });

  assert.equal(calls.count, 0);
  assert.deepEqual(lines, []);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].entry, standalonePaths(root).entry);
  assert.deepEqual(spawned[0].argumentsList, ["--port", "3999"]);
  await access(spawned[0].entry);
});

for (const [label, parts] of [
  ["standalone BUILD_ID", { standaloneBuildId: false }],
  ["static files", { staticFiles: false }],
] as const) {
  test(`a missing ${label} triggers exactly one rebuild before starting`, async (context) => {
    const { root } = await fixture(context);
    await writeBuild(root, parts);
    assert.equal((await dashboardBuildState(root)).ok, false);
    const calls = { count: 0 };
    const lines: string[] = [];
    const { spawned, spawnServer } = spawnRecorder();

    await startDashboard({ root, build: countingBuild(root, calls), log: (line: string) => lines.push(line), spawnServer });

    assert.equal(calls.count, 1);
    assert.deepEqual(lines, [REBUILT_MESSAGE]);
    assert.equal(spawned.length, 1);
    await access(spawned[0].entry);
  });
}

test("a failed build reports the reason and output path without starting", async (context) => {
  const { root, lockPath } = await fixture(context);
  await writeBuild(root, { standaloneBuildId: false });
  const calls = { count: 0 };
  const { spawned, spawnServer } = spawnRecorder();

  await assert.rejects(
    startDashboard({
      root,
      build: async () => {
        calls.count += 1;
        throw new Error("next build exited with code 1");
      },
      log: () => assert.fail("a failed build must not print the rebuilt line"),
      spawnServer,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /next build exited with code 1/);
      assert.ok(error.message.includes(join(root, ".next")));
      assert.match(error.message, /fix the build errors/i);
      return true;
    },
  );

  assert.equal(calls.count, 1);
  assert.equal(spawned.length, 0);
  assert.equal((await dashboardBuildState(root)).ok, false);
  await assert.rejects(access(lockPath));
});

test("a fresh lock waits for the running build instead of double-building", async (context) => {
  const { root, lockPath } = await fixture(context);
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const calls = { count: 0 };

  const pending = prepareDashboard({
    root,
    build: countingBuild(root, calls),
    pollIntervalMs: 10,
    waitTimeoutMs: 5000,
    log: () => assert.fail("the waiting start must not print the rebuilt line"),
  });
  setTimeout(() => {
    void writeBuild(root).then(() => rm(lockPath, { force: true }));
  }, 50);

  const result = await pending;
  assert.equal(calls.count, 0);
  assert.equal(result.rebuilt, false);
  assert.equal(result.waited, true);
  await access(result.entry);
});

test("a build that empties .next keeps a waiting starter waiting", async (context) => {
  const { root, lockPath } = await fixture(context);
  await writeBuild(root, { standaloneBuildId: false });
  const calls = { count: 0 };
  const lines: string[] = [];
  const buildStarted = deferred();
  const buildGate = deferred();

  const build = async () => {
    calls.count += 1;
    buildStarted.resolve();
    // next build cleans .next at startup; the lock must survive that.
    await rm(join(root, ".next"), { recursive: true, force: true });
    await buildGate.promise;
    await writeBuild(root);
  };

  const first = prepareDashboard({ root, build, log: (line) => lines.push(`first:${line}`) });
  await buildStarted.promise;
  const second = prepareDashboard({
    root,
    build,
    log: (line) => lines.push(`second:${line}`),
    pollIntervalMs: 10,
    waitTimeoutMs: 5000,
  });
  await new Promise((done) => setTimeout(done, 40));
  assert.equal(calls.count, 1);

  buildGate.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls.count, 1);
  assert.equal(firstResult.rebuilt, true);
  assert.equal(secondResult.rebuilt, false);
  assert.equal(secondResult.waited, true);
  assert.deepEqual(lines, [`first:${REBUILT_MESSAGE}`]);
  await access(secondResult.entry);
  await assert.rejects(access(lockPath));
});

test("a lock with a dead pid is stale and replaced", async (context) => {
  const { root, lockPath } = await fixture(context);
  await writeFile(lockPath, JSON.stringify({ pid: 2147483647, at: Date.now() }));
  const calls = { count: 0 };

  const result = await prepareDashboard({ root, build: countingBuild(root, calls), log: () => {} });

  assert.equal(calls.count, 1);
  assert.equal(result.rebuilt, true);
  await assert.rejects(access(lockPath));
});

test("an old lock is replaced and the build runs", async (context) => {
  const { root, lockPath } = await fixture(context);
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() - 31 * 60 * 1000 }));
  const calls = { count: 0 };

  const result = await prepareDashboard({ root, build: countingBuild(root, calls), log: () => {} });

  assert.equal(calls.count, 1);
  assert.equal(result.rebuilt, true);
  await assert.rejects(access(lockPath));
});

test("top-level files without the standalone bundle are rebuilt before starting", async (context) => {
  const { root } = await fixture(context);
  await writeBuild(root, { standaloneBuildId: false, standaloneServer: false, requiredServerFiles: false });
  const state = await dashboardBuildState(root);
  assert.equal(state.ok, false);
  assert.ok(state.missing.includes(".next/standalone/apps/dashboard/.next/BUILD_ID"));
  const calls = { count: 0 };
  const lines: string[] = [];
  const { spawned, spawnServer } = spawnRecorder();

  await startDashboard({ root, build: countingBuild(root, calls), log: (line: string) => lines.push(line), spawnServer });

  assert.equal(calls.count, 1);
  assert.deepEqual(lines, [REBUILT_MESSAGE]);
  assert.equal(spawned.length, 1);
  await access(spawned[0].entry);
});

test("a build that dies before the standalone copy never starts", async (context) => {
  const { root } = await fixture(context);
  await writeBuild(root, { standaloneBuildId: false, standaloneServer: false, requiredServerFiles: false });
  const calls = { count: 0 };
  const { spawned, spawnServer } = spawnRecorder();

  await assert.rejects(
    startDashboard({
      root,
      build: async () => {
        calls.count += 1;
        await writeBuild(root, { standaloneBuildId: false, standaloneServer: false, requiredServerFiles: false });
        throw new Error("build process was killed");
      },
      log: () => assert.fail("a failed build must not print the rebuilt line"),
      spawnServer,
    }),
    /Dashboard build failed: build process was killed/,
  );

  assert.equal(calls.count, 1);
  assert.equal(spawned.length, 0);
  assert.equal((await dashboardBuildState(root)).ok, false);
});

test("a build that returns with an incomplete standalone tree never starts", async (context) => {
  const { root } = await fixture(context);
  await writeBuild(root, { standaloneBuildId: false, standaloneServer: false, requiredServerFiles: false });
  const calls = { count: 0 };
  const { spawned, spawnServer } = spawnRecorder();

  await assert.rejects(
    startDashboard({
      root,
      build: async () => {
        calls.count += 1;
        await writeBuild(root, { standaloneBuildId: false, standaloneServer: false, requiredServerFiles: false });
      },
      log: () => assert.fail("an incomplete build must not print the rebuilt line"),
      spawnServer,
    }),
    /finished but is still incomplete/i,
  );

  assert.equal(calls.count, 1);
  assert.equal(spawned.length, 0);
  assert.equal((await dashboardBuildState(root)).ok, false);
});

test("the nested required-server-files.json from Next is accepted", async (context) => {
  const { root } = await fixture(context);
  await writeBuild(root, { requiredServerFiles: false });
  await writeFile(join(standalonePaths(root).standaloneNext, "required-server-files.json"), "{}");

  assert.equal((await dashboardBuildState(root)).ok, true);
});

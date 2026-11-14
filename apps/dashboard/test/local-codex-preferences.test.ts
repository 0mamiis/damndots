import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localCodexPreferences } from "../lib/local-codex-preferences";

test("a fresh dashboard can save preferences before Codex or its settings bridge is ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "dots-preferences-"));
  const dir = join(root, "settings");
  const stack = join(root, "stack");
  const url = "http://localhost/api/backend/orchestrator";
  const read = () => localCodexPreferences(new Request(url), ["orchestrator"], dir, stack);
  try {
    const initial = await read();
    assert.equal(initial.status, 200);
    const { installed, connected, applied, desktopState, managedBy, ...settings } = await initial.json();
    assert.deepEqual([installed, connected, applied, desktopState, managedBy], [false, false, false, "not-started", null]);
    const patch = (value: unknown) => localCodexPreferences(new Request(url, {
      method: "PATCH", body: JSON.stringify(value),
    }), ["orchestrator"], dir, stack);
    assert.equal((await patch({ ...settings, mode: "invalid" })).status, 400);
    assert.equal((await patch({ ...settings, mode: "lead", showOffDetails: true })).status, 200);
    const next = await (await read()).json();
    assert.equal(next.mode, "lead");
    assert.equal(next.showOffDetails, true);
    assert.equal(next.applied, false);
    const features = join(stack, "native", "desktop-features");
    await mkdir(features, { recursive: true });
    await writeFile(join(features, "status.json"), JSON.stringify({ state: "unsupported-version", packageVersion: "99.0.0.0" }));
    const unsupported = await (await read()).json();
    assert.equal(unsupported.desktopState, "unsupported-version");
    assert.equal(unsupported.packageVersion, "99.0.0.0");
    assert.equal(unsupported.mode, "lead");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

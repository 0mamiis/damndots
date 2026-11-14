import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import orchestrator from "../../../scripts/orchestrator-settings.cjs";
import tokenSpeed from "../../../scripts/token-speed-settings.cjs";
import scrollControls from "../../../scripts/scroll-controls-settings.cjs";
import catalog from "../../../scripts/composer-prediction-models.cjs";

// These preferences are local files shared with the Codex renderer. Only the
// caller (the authenticated dashboard route) decides whether access is allowed.
export async function localCodexPreferences(
  request: Request,
  path: string[],
  dir = join(homedir(), ".codex", "dots-local-bridge"),
  stack = resolve(/*turbopackIgnore: true*/ process.env.DOTS_STACK_DIR || join(process.cwd(), ".data", "local-stack")),
) {
  const headers = { "cache-control": "no-store" };
  if (path[1] === "models") {
    if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    try { return Response.json(await catalog.load(), { headers }); }
    catch { return Response.json({ models: [], available: false }, { headers }); }
  }
  const settings = path[0] === "orchestrator" ? orchestrator : path[0] === "token-speed" ? tokenSpeed : scrollControls;
  const features = join(stack, "native", "desktop-features");
  let desktopState = "not-started", packageVersion: string | undefined;
  try {
    const status = JSON.parse(await readFile(join(features, "status.json"), "utf8"));
    if (typeof status.state === "string") desktopState = status.state;
    if (typeof status.packageVersion === "string") packageVersion = status.packageVersion;
  } catch {}
  if (request.method === "PATCH") {
    let preferences;
    try { preferences = settings.validate(await request.json()); }
    catch { return Response.json({ error: "Invalid Codex preferences." }, { status: 400, headers }); }
    try { settings.write(dir, preferences); }
    catch { return Response.json({ error: "Could not save preferences to this Windows profile." }, { status: 500, headers }); }
  } else if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  }
  return Response.json({ ...settings.read(dir, join(features, "app")), desktopState, packageVersion }, { headers });
}

import { cp, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const dashboardRoot = resolve(import.meta.dirname, "..");
const standaloneRoot = join(dashboardRoot, ".next", "standalone", "apps", "dashboard");
const entry = join(standaloneRoot, "server.js");
await access(entry).catch(() => {
  throw new Error("Build the dashboard before starting: npm run build --workspace @dots/dashboard");
});
await cp(join(dashboardRoot, ".next", "static"), join(standaloneRoot, ".next", "static"), { recursive: true });
try {
  await access(join(dashboardRoot, "public"));
  await cp(join(dashboardRoot, "public"), join(standaloneRoot, "public"), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const argumentsList = process.argv.slice(2);
const argument = (name) => {
  const index = argumentsList.indexOf(name);
  return index < 0 ? undefined : argumentsList[index + 1];
};
const child = spawn(process.execPath, [entry], {
  cwd: standaloneRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTNAME: argument("--hostname") || process.env.DOTS_DASHBOARD_HOST || "127.0.0.1",
    PORT: argument("--port") || process.env.DOTS_DASHBOARD_PORT || "3000",
  },
});
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

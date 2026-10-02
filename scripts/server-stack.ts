import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { acquireLaunchLock } from '../apps/client/src/launch-policy.js';

/**
 * Headless backend for a VPS or always-on PC: the Dots server plus the Codex app-server it drives.
 * There is no dashboard, no native gateway and no worker here. Administer it from a dashboard on
 * another machine, and attach computers with the worker installer. Both processes are restarted
 * if they stop.
 */
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = resolve(process.env.DOTS_DATA_DIR || join(root, '.data/server'));
const serverPort = Number(process.env.DOTS_PORT || 9340);
const appServerPort = Number(process.env.DOTS_APPSERVER_PORT || 9912);
const serverUrl = 'http://127.0.0.1:' + serverPort;
await mkdir(dataDir, { recursive: true });

const release = await acquireLaunchLock(join(dataDir, 'stack.lock'));
if (!release) {
  console.log('The Dots server stack is already running.');
  process.exit(0);
}
process.once('exit', () => { void release(); });

const open = (port: number) => new Promise<boolean>((done) => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
  socket.setTimeout(500, () => { socket.destroy(); done(false); });
});

const children = new Map<string, ChildProcess>();
let closing = false;
function supervise(name: string, script: string, env: NodeJS.ProcessEnv) {
  const launch = () => {
    if (closing) return;
    const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    children.set(name, child);
    child.once('error', (error) => console.error(name + ': ' + error.message));
    child.once('exit', (code) => {
      children.delete(name);
      if (closing) return;
      console.error(name + ' stopped (' + code + '); restarting in 3 s');
      setTimeout(launch, 3000);
    });
  };
  launch();
}

const model = process.env.DOTS_MODEL || '';
supervise('app-server', 'scripts/appserver.ts', {
  DOTS_APPSERVER_LISTEN: 'ws://127.0.0.1:' + appServerPort,
  DOTS_CODEX_HOME: join(dataDir, 'codex-home'),
  DOTS_DATA_DIR: dataDir,
  DOTS_SERVER_URL: serverUrl,
  ...(model ? { DOTS_MODEL: model } : {}),
});
supervise('server', 'apps/server/src/index.ts', {
  DOTS_DATA_DIR: dataDir,
  DOTS_PORT: String(serverPort),
  DOTS_APPSERVER_URL: 'ws://127.0.0.1:' + appServerPort,
  ...(model ? { DOTS_MODEL: model } : {}),
  DOTS_REASONING_EFFORT: process.env.DOTS_REASONING_EFFORT || 'high',
});

for (let i = 0; i < 120; i++) {
  if (await open(serverPort) && await open(appServerPort)) {
    console.log('Dots server ready on ' + serverUrl + '. Admin key: ' + join(dataDir, 'admin.key'));
    break;
  }
  await new Promise((done) => setTimeout(done, 500));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    closing = true;
    for (const child of children.values()) child.kill();
    void release().finally(() => process.exit(0));
  });
}

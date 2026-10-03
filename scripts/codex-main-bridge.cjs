'use strict';
/**
 * Dots -> ana Codex app-server köprüsü (yalnızca bu makineden, token ile).
 *
 * Ana Codex app-server yalnızca bir unix soketi (kullanıcıya özel) dinler. SYSTEM gibi başka bir hesapta
 * çalışan Dots sunucusu o sokete doğrudan bağlanamaz. Bu küçük köprü kullanıcı hesabıyla çalışır,
 * 127.0.0.1:PORT üzerinde dinler, ilk HTTP isteğinde "Authorization: Bearer <token>" doğrular ve ardından
 * baytları "codex app-server proxy" aracılığıyla ana app-server'a iletir. Böylece Dots, masaüstü Codex ile
 * AYNI app-server'ı (aynı thread'ler, aynı yazar kilitleri) kullanır; ikinci bir app-server gerekmez.
 */
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {homedir}=require('os');

const configIndex=process.argv.indexOf('--config');
const config=configIndex<0?{}:JSON.parse(fs.readFileSync(process.argv[configIndex+1],'utf8').replace(/^\uFEFF/,''));
const CODEX_HOME = config.codexHome||process.env.CODEX_HOME || path.join(homedir(), '.codex');
const CLI = config.cli||process.env.BRIDGE_CODEX_CLI || path.join(CODEX_HOME, 'appserver', process.platform==='win32'?'codex.exe':'codex');
const SOCK = config.socket||process.env.BRIDGE_SOCKET || path.join(CODEX_HOME, 'app-server-control', 'app-server-control.sock');
const DIR = config.directory||process.env.BRIDGE_DIR || (process.platform==='win32'?path.join(process.env.ProgramData||'C:\\ProgramData','DotsCodexBridge'):path.join(homedir(),'.local','state','dots-codex-bridge'));
const TOKEN_FILE = config.tokenFile||process.env.BRIDGE_TOKEN_FILE || path.join(DIR, 'token.txt');
const LOG = path.join(DIR, 'bridge.log');
const PORT = Number(config.port||process.env.BRIDGE_PORT || 9913);
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('Invalid bridge port');
const MAX_CONNECTIONS = 8;
const AUTH_TIMEOUT_MS = 5000;
const MAX_HEAD_BYTES = 16384;

function log(message) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 262144) fs.writeFileSync(LOG, '');
    fs.appendFileSync(LOG, new Date().toISOString() + ' ' + message + '\n');
  } catch { /* günlük yazılamıyorsa köprü yine çalışır */ }
}
const digest = value => crypto.createHash('sha256').update(value).digest();
function tokenOk(given) {
  let expected = '';
  try { expected = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return false; }
  if (expected.length < 32) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

let active = 0;
const server = net.createServer(socket => {
  if (active >= MAX_CONNECTIONS) { socket.destroy(); return; }
  active++;
  let buffer = Buffer.alloc(0), child = null, finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true; active--;
    try { if (child) child.kill(); } catch { /* süreç zaten kapandı */ }
    try { socket.destroy(); } catch { /* soket zaten kapandı */ }
  };
  socket.setNoDelay(true);
  socket.setTimeout(AUTH_TIMEOUT_MS, () => { if (!child) { log('doğrulama zaman aşımı'); cleanup(); } });
  socket.on('error', cleanup);
  socket.on('close', cleanup);
  const onData = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_HEAD_BYTES) { cleanup(); return; }
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    socket.off('data', onData);
    const head = buffer.subarray(0, end).toString('latin1');
    const match = /^authorization:[ \t]*bearer[ \t]+(\S+)[ \t]*$/im.exec(head);
    if (!match || !tokenOk(match[1])) {
      log('reddedildi: ' + socket.remoteAddress);
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      setTimeout(cleanup, 300);
      return;
    }
    socket.setTimeout(0);
    child = spawn(CLI, ['app-server', 'proxy', '--sock', SOCK], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CODEX_HOME } });
    child.on('error', error => { log('proxy başlatılamadı: ' + error.message); cleanup(); });
    child.on('exit', cleanup);
    child.stderr.on('data', data => log('proxy: ' + String(data).replace(/\s+/g, ' ').slice(0, 300)));
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stdout.pipe(socket);
    child.stdin.write(buffer);
    socket.pipe(child.stdin);
  };
  socket.on('data', onData);
});
server.on('error', error => { log('sunucu hatası: ' + error.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => log('dinliyor 127.0.0.1:' + PORT));

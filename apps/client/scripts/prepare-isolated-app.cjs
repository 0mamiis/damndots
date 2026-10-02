'use strict';
// Patch only a private application copy. The installed package remains untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [sourceArg, destinationArg, gatewayBase = 'https://localhost:8000'] = process.argv.slice(2);
const source = path.resolve(sourceArg), destination = path.resolve(destinationArg);
const srcAsar = path.join(source, 'resources', 'app.asar');
const dstAsar = path.join(destination, 'resources', 'app.asar');
const stampFile = path.join(destination, 'orbit-patch.json');
const stat = fs.statSync(srcAsar);
const signature = {source, size: stat.size, modified: stat.mtimeMs, patchVersion: 6, gatewayBase};
try {
  const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  if (Object.keys(signature).every(k => stamp[k] === signature[k]) && fs.existsSync(dstAsar)) { console.log('Isolated app copy ready'); process.exit(0); }
} catch {}
if (source === destination || destination.startsWith(source + path.sep)) throw new Error('Application copy must be outside the installed package');
fs.mkdirSync(destination, {recursive: true});
fs.cpSync(source, destination, {recursive: true, force: true});
const fd = fs.openSync(dstAsar, 'r+');
try {
  const prefix = Buffer.alloc(16); fs.readSync(fd, prefix, 0, 16, 0);
  const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12), dataStart = 8 + headerSize;
  const rawHeader = Buffer.alloc(jsonSize); fs.readSync(fd, rawHeader, 0, jsonSize, 16);
  const header = JSON.parse(rawHeader.toString());
  const build = header.files['.vite'].files.build.files;
  const filename = Object.keys(build).find(n => /^main-.*\.js$/.test(n));
  if (!filename) throw new Error('Installed app main entry was not found');
  const entry = build[filename];
  const original = Buffer.alloc(entry.size); fs.readSync(fd, original, 0, entry.size, dataStart + Number(entry.offset));
  let js = original.toString();
  function replaceOnce(before, after) {
    if (js.split(before).length !== 2) throw new Error('Application version is incompatible with isolated Orbit patch: ' + before.slice(0, 80));
    js = js.replace(before, after);
  }
  replaceOnce('var Que=`wss://codex-cloud-backend.chatgpt.com/`', 'var Que=process.env.ORBIT_DURABLE_WS_URL||`wss://codex-cloud-backend.chatgpt.com/`');
  // For an explicitly configured local app-server, read history through its native RPC transport.
  replaceOnce('return r.Fn(e.hostConfig.id)&&t!=null?new ide(', 'return!process.env.ORBIT_DURABLE_WS_URL&&r.Fn(e.hostConfig.id)&&t!=null?new ide(');
  // The CLI listener uses native RPC without the hosted service's authentication subprotocol.
  replaceOnce('protocols:ke(e,`desktop`)', 'protocols:process.env.ORBIT_DURABLE_WS_URL?null:ke(e,`desktop`)');
  replaceOnce('if(n===`localhost`||n===`localhost:8000`)return!0', 'if(t.origin==='+JSON.stringify(new URL(gatewayBase).origin)+'||n===`localhost`||n===`localhost:8000`)return!0');
  replaceOnce('Sign in to ChatGPT to start a durable thread.', 'Sign in to start a thread.');
  replaceOnce('Failed to load CA certificates for cloud WebSocket', 'Cloud CA read failed');
  js = js.replaceAll('App server account changed', 'Account changed');
  js = js.replaceAll('Refusing to attach authentication to non-OpenAI URL', 'Authentication origin rejected').replaceAll('Refusing to attach desktop surface to non-OpenAI URL','Desktop origin rejected');
  js = js.replace(/\/\/# sourceMappingURL=[^\r\n]+/g, '');
  const patched = Buffer.from(js);
  if (patched.length > original.length) throw new Error('Size-preserving isolated patch exceeds the reserved space');
  const final = Buffer.alloc(original.length, 32); patched.copy(final);
  fs.writeSync(fd, final, 0, final.length, dataStart + Number(entry.offset));
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  if (entry.integrity) {
    if (entry.integrity.algorithm !== 'SHA256') throw new Error('Unsupported ASAR integrity algorithm');
    entry.integrity.hash = sha(final);
    entry.integrity.blocks = [];
    for (let start = 0; start < final.length; start += entry.integrity.blockSize) entry.integrity.blocks.push(sha(final.subarray(start, start + entry.integrity.blockSize)));
  }
  // Resmi bilgisayar paneli (WebRTC canlı video) özgün haliyle kalır; sunucu /computer/sessions yanıtını verir.
  const newHeader = Buffer.from(JSON.stringify(header));
  if (newHeader.length !== rawHeader.length) throw new Error('ASAR header size changed');
  fs.writeSync(fd, newHeader, 0, newHeader.length, 16);
  // Keep Electron's ASAR integrity verification enabled and update the private launcher's build digest.
  const oldDigest = sha(rawHeader), newDigest = sha(newHeader);
  const launcher = path.join(destination, 'ChatGPT.exe');
  const launcherBytes = fs.readFileSync(launcher), digestBytes = Buffer.from(oldDigest);
  const digestOffset = launcherBytes.indexOf(digestBytes);
  if (digestOffset < 0 || launcherBytes.indexOf(digestBytes, digestOffset + 1) >= 0) throw new Error('Private launcher integrity record is incompatible');
  Buffer.from(newDigest).copy(launcherBytes, digestOffset);
  fs.writeFileSync(launcher, launcherBytes);
  fs.writeFileSync(stampFile, JSON.stringify({...signature, main: filename, mainSha256: sha(final), headerSha256: newDigest}, null, 2));
  console.log('Prepared isolated Orbit application; installed package unchanged');
} finally { fs.closeSync(fd); }

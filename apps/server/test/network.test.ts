import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsPlainHttp, isLoopbackHost, isTailnetHost, tailnetInterfaceUp } from '@dots/contracts/network';
import { NetworkService, type Exec } from '../src/network.js';

const tailnet = { Tailscale: [{ address: '100.121.163.14', family: 'IPv4', internal: false, netmask: '255.255.255.255', cidr: null, mac: '' }] } as any;
const lan = { Ethernet: [{ address: '192.168.1.6', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: null, mac: '' }] } as any;

test('plain HTTP is allowed for loopback and for Tailscale addresses only while a Tailscale interface exists', () => {
  assert(isLoopbackHost('127.0.0.1') && isLoopbackHost('[::1]') && isLoopbackHost('localhost'));
  assert(isTailnetHost('100.64.0.1') && isTailnetHost('100.127.255.254') && isTailnetHost('[fd7a:115c:a1e0::a701:a3d0]'));
  for (const outside of ['100.63.255.255', '100.128.0.1', '192.168.1.6', '8.8.8.8', 'example.com', '100.64.0.256', '100.64.0'])
    assert.equal(isTailnetHost(outside), false, outside);
  assert.equal(tailnetInterfaceUp(tailnet), true);
  assert.equal(tailnetInterfaceUp(lan), false);
  assert.equal(allowsPlainHttp('100.93.24.90', tailnet), true);
  assert.equal(allowsPlainHttp('100.93.24.90', lan), false);
  assert.equal(allowsPlainHttp('127.0.0.1', lan), true);
  assert.equal(allowsPlainHttp('203.0.113.7', tailnet), false);
});

function fake(state: { serve: Record<string, unknown>; calls: string[][]; backend?: string }): Exec {
  return async (_file, args) => {
    state.calls.push(args);
    if (args[0] === 'status') return { stdout: JSON.stringify({ BackendState: state.backend ?? 'Running', Self: { HostName: 'pc', DNSName: 'pc.example.ts.net.', TailscaleIPs: ['100.121.163.14', 'fd7a:115c:a1e0::a701:a3d0'] }, Peer: { a: { HostName: 'vps', TailscaleIPs: ['100.93.24.90'], OS: 'windows', Online: true }, b: { HostName: 'phone', TailscaleIPs: [], OS: 'android', Online: false } } }) };
    if (args[0] === 'serve' && args[1] === 'status') return { stdout: JSON.stringify({ TCP: state.serve }) };
    if (args[0] === 'serve' && args.includes('off')) { delete state.serve[args[args.indexOf('--tcp') + 1]]; return { stdout: '' }; }
    if (args[0] === 'serve') { state.serve[args[args.indexOf('--tcp') + 1]] = { TCPForward: args[args.length - 1].replace('tcp://', '') }; return { stdout: '' }; }
    throw new Error('unexpected ' + args.join(' '));
  };
}

test('network status reports the tailnet address only when this server port is forwarded to loopback', async () => {
  const state = { serve: {} as Record<string, unknown>, calls: [] as string[][] };
  const service = new NetworkService({ host: '127.0.0.1', port: 9340 }, fake(state), ['tailscale']);
  let status = await service.status();
  assert.equal(status.tailscale.state, 'Running');
  assert.deepEqual(status.tailscale.ips, ['100.121.163.14', 'fd7a:115c:a1e0::a701:a3d0']);
  assert.equal(status.tailscale.dnsName, 'pc.example.ts.net');
  assert.equal(status.exposed, false);
  assert.equal(status.address, null);
  assert.deepEqual(status.peers.map((p) => p.name), ['vps']);
  status = await service.setExposed(true);
  assert.equal(status.exposed, true);
  assert.equal(status.address, 'http://100.121.163.14:9340');
  assert.deepEqual(state.calls.find((c) => c[0] === 'serve' && c.includes('--bg')), ['serve', '--bg', '--tcp', '9340', 'tcp://127.0.0.1:9340']);
  status = await service.setExposed(false);
  assert.equal(status.exposed, false);
});

test('a forward to another target or port does not count as exposure', async () => {
  const state = { serve: { '9340': { TCPForward: '127.0.0.1:1234' }, '9341': { TCPForward: '127.0.0.1:9341' } } as Record<string, unknown>, calls: [] as string[][] };
  const service = new NetworkService({ host: '127.0.0.1', port: 9340 }, fake(state), ['tailscale']);
  assert.equal((await service.status()).exposed, false);
});

test('missing or stopped Tailscale is reported without throwing, and exposure is refused for non-loopback listeners', async () => {
  const missing: Exec = async () => { throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }); };
  const none = await new NetworkService({ host: '127.0.0.1', port: 9340 }, missing, ['tailscale']).status();
  assert.equal(none.tailscale.installed, false);
  assert.equal(none.exposed, false);
  await assert.rejects(new NetworkService({ host: '127.0.0.1', port: 9340 }, missing, ['tailscale']).setExposed(true), /kurulu değil/);
  const stopped = await new NetworkService({ host: '127.0.0.1', port: 9340 }, fake({ serve: { '9340': { TCPForward: '127.0.0.1:9340' } }, calls: [], backend: 'Stopped' }), ['tailscale']).status();
  assert.equal(stopped.exposed, false);
  await assert.rejects(new NetworkService({ host: '0.0.0.0', port: 9340 }, fake({ serve: {}, calls: [] }), ['tailscale']).setExposed(true), /loopback/);
});

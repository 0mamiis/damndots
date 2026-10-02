import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * Where a plain-HTTP connection is acceptable. Loopback never leaves the machine. A Tailscale
 * address is routed through the encrypted WireGuard tunnel, but only while this machine actually
 * has a Tailscale interface; otherwise 100.64.0.0/10 could be an ordinary carrier network.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

function ipv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((total, p) => total * 256 + Number(p), 0);
}

/** Tailscale addresses: 100.64.0.0/10 and the fd7a:115c:a1e0::/48 unique-local range. */
export function isTailnetHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const number = ipv4(host);
  if (number !== null) return number >= 0x64400000 && number <= 0x647fffff;
  return host.startsWith('fd7a:115c:a1e0:');
}

export function tailnetInterfaceUp(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): boolean {
  return Object.values(interfaces).some((list) => (list ?? []).some((entry) => isTailnetHost(entry.address)));
}

export function allowsPlainHttp(hostname: string, interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): boolean {
  return isLoopbackHost(hostname) || (isTailnetHost(hostname) && tailnetInterfaceUp(interfaces));
}

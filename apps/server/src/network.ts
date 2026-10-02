import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { isTailnetHost } from '@dots/contracts/network';

export interface TailscaleStatus {
  installed: boolean;
  state: string | null;
  hostname: string | null;
  dnsName: string | null;
  ips: string[];
  error: string | null;
}
export interface NetworkPeer { name: string; ip: string; os: string; online: boolean; }
export interface NetworkStatus {
  tailscale: TailscaleStatus;
  /** True when this server's port is forwarded to the tailnet only. */
  exposed: boolean;
  listen: { host: string; port: number };
  /** Address other machines on the tailnet use to reach this server, when it is exposed. */
  address: string | null;
  peers: NetworkPeer[];
}
export type Exec = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;

const execute = promisify(execFile);
const defaultExec: Exec = (file, args, options) => execute(file, args, { ...options, windowsHide: true, encoding: 'utf8' }) as Promise<{ stdout: string }>;

export function tailscaleCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'].filter((p) => p === 'tailscale' || existsSync(p));
  if (platform === 'darwin') return ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].filter((p) => p === 'tailscale' || existsSync(p));
  return ['tailscale'];
}

/**
 * Reads Tailscale state and toggles one fixed forward (tailnet port -> this server's loopback port).
 * It never accepts a command, path or address from a request: only the configured port is used.
 */
export class NetworkService {
  constructor(
    private listen: { host: string; port: number },
    private exec: Exec = defaultExec,
    private candidates: string[] = tailscaleCandidates(),
  ) {}

  private async tailscale(args: string[]): Promise<string> {
    let missing = true;
    let last: unknown;
    for (const file of this.candidates) {
      try { return (await this.exec(file, args, { timeout: 8000 })).stdout; }
      catch (error) { last = error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') missing = false; }
    }
    throw Object.assign(new Error(missing ? 'Tailscale bulunamadı.' : (last as Error).message), { code: missing ? 'ENOENT' : 'EFAIL' });
  }

  private async forwards(): Promise<Record<string, { TCPForward?: string }>> {
    try {
      const value = JSON.parse((await this.tailscale(['serve', 'status', '--json'])) || '{}');
      return value.TCP && typeof value.TCP === 'object' ? value.TCP : {};
    } catch { return {}; }
  }

  async status(): Promise<NetworkStatus> {
    const port = this.listen.port;
    const base: NetworkStatus = { tailscale: { installed: false, state: null, hostname: null, dnsName: null, ips: [], error: null }, exposed: false, listen: this.listen, address: null, peers: [] };
    let json: any;
    try { json = JSON.parse(await this.tailscale(['status', '--json'])); }
    catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return { ...base, tailscale: { ...base.tailscale, installed: !missing, error: (error as Error).message } };
    }
    const ips: string[] = Array.isArray(json.Self?.TailscaleIPs) ? json.Self.TailscaleIPs.filter((ip: unknown) => typeof ip === 'string' && isTailnetHost(ip)) : [];
    const peers: NetworkPeer[] = Object.values<any>(json.Peer ?? {}).map((peer) => ({ name: String(peer.HostName ?? ''), ip: String((peer.TailscaleIPs ?? [])[0] ?? ''), os: String(peer.OS ?? ''), online: !!peer.Online })).filter((peer) => peer.ip);
    const running = json.BackendState === 'Running';
    const forward = (await this.forwards())[String(port)]?.TCPForward;
    const exposed = running && !!forward && /^(127\.0\.0\.1|localhost|\[::1\]):/.test(forward) && Number(forward.split(':').pop()) === port;
    const v4 = ips.find((ip) => !ip.includes(':'));
    return {
      tailscale: { installed: true, state: typeof json.BackendState === 'string' ? json.BackendState : null, hostname: json.Self?.HostName ?? null, dnsName: typeof json.Self?.DNSName === 'string' ? json.Self.DNSName.replace(/\.$/, '') : null, ips, error: null },
      exposed, listen: this.listen, address: exposed && v4 ? 'http://' + v4 + ':' + port : null, peers,
    };
  }

  async setExposed(enabled: boolean): Promise<NetworkStatus> {
    const port = this.listen.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('Geçersiz sunucu portu.'), { statusCode: 400 });
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(this.listen.host);
    if (enabled && !loopback) throw Object.assign(new Error('Sunucu loopback dışında dinliyor; Tailscale yönlendirmesi gerekmez.'), { statusCode: 409 });
    try {
      if (enabled) await this.tailscale(['serve', '--bg', '--tcp', String(port), 'tcp://127.0.0.1:' + port]);
      else await this.tailscale(['serve', '--tcp', String(port), 'off']);
    } catch (error) {
      throw Object.assign(new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Tailscale bu bilgisayarda kurulu değil.' : 'Tailscale yönlendirmesi değiştirilemedi: ' + (error as Error).message.slice(0, 300)), { statusCode: 502 });
    }
    return this.status();
  }
}

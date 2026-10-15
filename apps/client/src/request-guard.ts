import type { IncomingHttpHeaders } from 'node:http';

/** Sites the user's browser may legitimately load that talk to this gateway (the gateway's own pages and OpenAI web apps). */
const TRUSTED_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|(?:[a-z0-9-]+\.)*(?:chatgpt\.com|openai\.com))$/i;

export interface GuardResult { block: boolean; reason: string; }
const ok: GuardResult = { block: false, reason: '' };

/**
 * The gateway adds the Dots credentials itself, so a web page that makes the user's browser call
 * https://localhost:<port> would otherwise act with the owner's identity. Browsers always label such requests.
 * - A page on any other website sends its own Origin, or Fetch Metadata of a page-driven load.
 * - A simple cross-site request (the only kind a page can send without a CORS preflight) cannot carry an
 *   Authorization header, but every request from the desktop app does.
 */
export function inspectRequest(headers: IncomingHttpHeaders, url: URL): GuardResult {
  const origin = typeof headers.origin === 'string' ? headers.origin : undefined;
  if (origin !== undefined) {
    let parsed: URL | undefined;
    if (origin !== 'null') { try { parsed = new URL(origin); } catch { return { block: true, reason: 'invalid Origin' }; } }
    if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      if (!TRUSTED_HOST.test(parsed.hostname)) return { block: true, reason: 'web page origin ' + parsed.origin };
    } else if (!headers.authorization && !url.pathname.startsWith('/auth/') && !url.searchParams.has('t')) {
      return { block: true, reason: 'unauthenticated browser request from ' + origin };
    }
  }
  const site = headers['sec-fetch-site'], mode = headers['sec-fetch-mode'];
  if ((site === 'cross-site' || site === 'same-site') && (mode === 'no-cors' || mode === 'navigate')) return { block: true, reason: 'page-driven ' + mode + ' load (' + site + ')' };
  return ok;
}

/** DOTS_GATEWAY_GUARD: 'on' (default) refuses, 'log' only reports what it would refuse, 'off' disables the checks. */
export type GuardMode = 'on' | 'log' | 'off';
export const guardMode = (value: string | undefined = process.env.DOTS_GATEWAY_GUARD): GuardMode => value === 'off' || value === 'log' ? value : 'on';

/** A secret-free description of a request, used to review what the guard would see from the real app. */
export function fingerprint(method: string | undefined, headers: IncomingHttpHeaders, url: URL): string {
  // An Origin header is only scheme://host[:port], never a credential.
  const origin = typeof headers.origin === 'string' ? (/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9.:\[\]-]{1,100}$|^null$/i.test(headers.origin) ? headers.origin : 'invalid') : '-';
  const part = (name: string) => (typeof headers[name] === 'string' ? headers[name] : '-');
  return [method || '?', '/' + url.pathname.split('/').slice(1, 3).join('/'), 'origin=' + origin, 'site=' + part('sec-fetch-site'), 'mode=' + part('sec-fetch-mode'), 'dest=' + part('sec-fetch-dest'), 'auth=' + (headers.authorization ? 'yes' : 'no'), 'query-token=' + (url.searchParams.has('t') ? 'yes' : 'no')].join(' ');
}

/** Only an absolute-path request target is accepted; '//host/path' would otherwise be resolved as another host. */
export function requestTarget(rawUrl: string | undefined, server: string): URL | undefined {
  if (!rawUrl || !/^\/(?!\/|\\)/.test(rawUrl)) return undefined;
  const base = new URL(server), url = new URL(rawUrl, base);
  return url.origin === base.origin ? url : undefined;
}

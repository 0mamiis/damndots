import { cookies } from "next/headers";
import { allowsPlainHttp } from "@dots/contracts/network";
export const SESSION_COOKIE = "dots_session";
export const SERVER_COOKIE = "dots_server";
export function requestProtocol(request: Request) {
  return (
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
    new URL(request.url).protocol.replace(":", "")
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const requestHost = request.headers.get("host") ?? new URL(request.url).host;
  return (
    (!origin || origin === `${requestProtocol(request)}://${requestHost}`) &&
    (!site || site === "same-origin" || site === "none")
  );
}
/**
 * Servers this dashboard may talk to. When the dashboard is reachable by other people,
 * set DOTS_SERVER_URL (or a comma separated DOTS_ALLOWED_SERVERS) so visitors cannot make
 * it call arbitrary addresses on its own network.
 */
export function allowedServers(
  env: Record<string, string | undefined> = process.env,
) {
  const list = [env.DOTS_ALLOWED_SERVERS, env.DOTS_SERVER_URL]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}
export function validateServer(
  value: string,
  allowed: Set<string> | null = allowedServers(),
) {
  const url = new URL(value);
  const local = allowsPlainHttp(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!local && url.protocol !== "https:")
  )
    throw new Error(
      "Yerel sunucu veya Tailscale adresi için HTTP, diğer uzak sunucular için HTTPS adresi kullanın.",
    );
  if (allowed && !allowed.has(url.origin))
    throw new Error("Bu panel yalnızca yapılandırılmış Dots sunucusuna bağlanabilir.");
  return url.origin;
}
export async function session() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const server = jar.get(SERVER_COOKIE)?.value;
  if (!token || !server) return null;
  let validated:string;
  try{validated=validateServer(server);}catch(error){const candidate=validateServer(server,null);const {registeredHost}=await import('./controller');if(!await registeredHost(candidate))throw error;validated=candidate;}
  return { token, server: validated };
}

import { cookies } from "next/headers";
import {CONTROLLER_COOKIE,controllerOrigin} from '@/lib/controller';
import {
  SESSION_COOKIE,
  SERVER_COOKIE,
  sameOrigin,
  validateServer,
  requestProtocol,
} from "@/lib/session";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "İstek kaynağı doğrulanamadı." },
      { status: 403 },
    );
  try {
    const body = await request.json();
    const server = validateServer(String(body.serverUrl));
    if (!body.token)
      return Response.json(
        { error: "Yönetici erişim anahtarı gerekli." },
        { status: 400 },
      );
    const response = await fetch(`${server}/api/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: body.token }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Sunucu oturumu açılamadı." }));
      return Response.json(
        {
          error:
            error.error ?? error.message ?? "Erişim anahtarı doğrulanamadı.",
        },
        { status: response.status },
      );
    }
    const data = await response.json();
    if (typeof data.accessToken !== "string")
      throw new Error("Sunucu geçerli bir oturum döndürmedi.");
    const jar = await cookies();
    const expires = new Date(data.expiresAt);
    const options = {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: requestProtocol(request) === "https",
      path: "/",
      expires: Number.isFinite(expires.getTime())
        ? expires
        : new Date(Date.now() + 3600000),
    };
    jar.set(SESSION_COOKIE, data.accessToken, options);
    jar.set(SERVER_COOKIE, server, options);
    if(server===controllerOrigin())jar.set(CONTROLLER_COOKIE,data.accessToken,options);
    return Response.json({ connected: true, server });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Bağlantı kurulamadı.",
      },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "İstek kaynağı doğrulanamadı." },
      { status: 403 },
    );
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(SERVER_COOKIE);
  jar.delete(CONTROLLER_COOKIE);
  return Response.json({ connected: false });
}

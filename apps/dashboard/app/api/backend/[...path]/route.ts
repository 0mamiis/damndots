import { session, sameOrigin } from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowed = new Set([
  "overview",
  "settings",
  "computer-transport",
  "dots",
  "tasks",
  "activity",
  "outputs",
  "memories",
  "schedules",
  "approvals",
  "computers",
  "clients",
  "browser",
  "connectors",
  "voice",
  "providers",
  "models",
  "events",
]);
async function proxy(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (
    !allowed.has(path[0]) ||
    path.some((p) => p === "." || p === ".." || p.includes("/"))
  )
    return Response.json({ error: "Geçersiz API yolu." }, { status: 404 });
  if (request.method !== "GET" && !sameOrigin(request))
    return Response.json(
      { error: "İstek kaynağı doğrulanamadı." },
      { status: 403 },
    );
  try {
    const auth = await session();
    if (!auth)
      return Response.json({ error: "Sunucuya bağlanın." }, { status: 401 });
    const url = new URL(
      `${auth.server}/api/v1/${path.map(encodeURIComponent).join("/")}`,
    );
    url.search = new URL(request.url).search;
    const headers = new Headers({ authorization: `Bearer ${auth.token}` });
    for (const name of ["content-type", "last-event-id"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "error",
      signal:
        path[0] === "events"
          ? request.signal
          : AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
    });
    const responseHeaders = new Headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-type", "content-disposition"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Sunucuya ulaşılamadı.",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE,proxy as PUT };

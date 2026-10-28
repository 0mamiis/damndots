import { session, sameOrigin } from "@/lib/session";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  "telegram",
  "chat-suggestions",
  "token-speed",
  "orchestrator",
  "providers",
  "models",
  "events",
  "network",
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
    return Response.json({ error: "Invalid API path." }, { status: 404 });
  if (request.method !== "GET" && !sameOrigin(request))
    return Response.json(
      { error: "Request origin could not be verified." },
      { status: 403 },
    );
  try {
    const auth = await session();
    if (!auth)
      return Response.json({ error: "Connect to a server first." }, { status: 401 });
    if((path[0]==="token-speed"&&path.length===1||path[0]==="orchestrator"&&(path.length===1||path.length===2&&path[1]==="models"))&&process.platform==="win32"){
      if(!["GET","PATCH"].includes(request.method))return Response.json({error:"Method not allowed"},{status:405});
      const token=await readFile(join(homedir(),".codex","dots-local-bridge","token.txt"),"utf8");
      const r=await fetch("http://127.0.0.1:9915/"+path.join("/"),{method:request.method,headers:{authorization:"Bearer "+token.trim(),"content-type":"application/json"},...(request.method==="PATCH"?{body:await request.text()}:{}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
      return new Response(await r.text(),{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
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
        error: error instanceof Error ? error.message : "Could not reach the server.",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE,proxy as PUT };

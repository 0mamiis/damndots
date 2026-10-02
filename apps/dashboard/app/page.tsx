import { cookies } from "next/headers";
import { Dashboard } from "@/components/dashboard";
import { allowedServers } from "@/lib/session";
export const dynamic = "force-dynamic";
export default async function Page() {
  const jar = await cookies();
  const allowed = allowedServers();
  return (
    <Dashboard
      connected={Boolean(
        jar.get("dots_session")?.value && jar.get("dots_server")?.value,
      )}
      serverLabel={jar.get("dots_server")?.value ?? ""}
      defaultServer={[...(allowed ?? [])][0] ?? "http://127.0.0.1:9340"}
      serverLocked={Boolean(allowed && allowed.size === 1)}
    />
  );
}

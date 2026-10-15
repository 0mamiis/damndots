"use client";
import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Actions, Code, Disclose, Loading, Notice, Section, api, useData } from "./ui";

export interface NetworkStatus {
  tailscale: { installed: boolean; state: string | null; hostname: string | null; dnsName: string | null; ips: string[]; error: string | null };
  exposed: boolean;
  listen: { host: string; port: number };
  address: string | null;
  peers: { name: string; ip: string; os: string; online: boolean }[];
}

export const INSTALLER = "https://raw.githubusercontent.com/0mamiis/damndots/main/scripts/install-windows-worker.ps1";

/** Tailscale state of the active server and the switch that forwards its port to the tailnet only. */
export function NetworkPanel() {
  const [status, setStatus] = useState<NetworkStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setStatus(await api<NetworkStatus>("network"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, []);
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await api<NetworkStatus>("network/tailscale", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ts = status?.tailscale;
  return (
    <Section
      title="Network access"
      description="How the active server is exposed to other computers through Tailscale. Traffic is encrypted and the server is not opened to the internet."
    >
      <Notice error={error} />
      {!status && !error && <Loading />}
      {status && ts && !ts.installed && (
        <p className="text-sm text-muted">Tailscale is not installed on the computer running this server. Install it from tailscale.com/download and sign in.</p>
      )}
      {status && ts?.installed && ts.state !== "Running" && (
        <p className="text-sm text-muted">Tailscale is not running{ts.state ? " (state: " + ts.state + ")" : ""}. Open the Tailscale app and sign in.</p>
      )}
      {status && ts?.installed && ts.state === "Running" && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Computer: {ts.hostname ?? "—"}</span>
            <span>Address: {ts.ips.find((ip) => !ip.includes(":")) ?? "—"}</span>
            <span>Server port: {status.listen.port}</span>
          </div>
          <p className="text-sm">
            {status.exposed
              ? "The server is open to the tailnet. Computers on the same Tailscale account connect with this address: "
              : "The server can only be reached from this computer. Open it to the tailnet so another PC or VPS can connect."}
            {status.address && <strong className="break-all">{status.address}</strong>}
          </p>
          <Actions>
            <Button size="sm" isDisabled={busy} onPress={() => void toggle(!status.exposed)}>
              {status.exposed ? "Turn off tailnet access" : "Open to the tailnet"}
            </Button>
          </Actions>
          {status.peers.length > 0 && (
            <Disclose summary={"Devices on the tailnet (" + status.peers.length + ")"}>
              <ul className="text-sm">
                {status.peers.map((peer) => (
                  <li key={peer.ip}>
                    {peer.name} · {peer.ip} · {peer.os || "unknown"} · {peer.online ? "online" : "offline"}
                  </li>
                ))}
              </ul>
            </Disclose>
          )}
        </>
      )}
    </Section>
  );
}

/** Commands that connect another Windows PC or VPS to this server; shown next to a fresh enrollment code. */
export function RemoteInstall({ token }: { token: string }) {
  const network = useData<NetworkStatus>("network");
  const address = network.data?.address ? new URL(network.data.address) : null;
  return (
    <Disclose summary="Commands for a remote Windows PC or VPS">
      {!address ? (
        <p className="text-sm text-muted">
          First open this server to the tailnet under Network access in the Servers section. The remote computer connects to the server at this address.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Open an administrator PowerShell on the remote computer and run these in order. The second command consumes the enrollment key.</p>
          <Code>{"irm " + INSTALLER + " -OutFile $env:TEMP\\install-dots-worker.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-dots-worker.ps1 -ServerAddress " + address.hostname + " -ServerPort " + (address.port || "80")}</Code>
          <Code>{"C:\\Dots\\start-worker.cmd --enrollment " + token}</Code>
        </div>
      )}
    </Disclose>
  );
}

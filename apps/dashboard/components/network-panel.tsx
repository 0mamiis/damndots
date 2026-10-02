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
      title="Ağ erişimi"
      description="Aktif sunucunun başka bilgisayarlara Tailscale üzerinden nasıl açılacağı. Trafik şifrelenir ve sunucu internete açılmaz."
    >
      <Notice error={error} />
      {!status && !error && <Loading />}
      {status && ts && !ts.installed && (
        <p className="text-sm text-muted">Tailscale bu sunucunun çalıştığı bilgisayarda kurulu değil. tailscale.com/download adresinden kurup giriş yap.</p>
      )}
      {status && ts?.installed && ts.state !== "Running" && (
        <p className="text-sm text-muted">Tailscale çalışmıyor{ts.state ? " (durum: " + ts.state + ")" : ""}. Tailscale uygulamasını açıp giriş yap.</p>
      )}
      {status && ts?.installed && ts.state === "Running" && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Bilgisayar: {ts.hostname ?? "—"}</span>
            <span>Adres: {ts.ips.find((ip) => !ip.includes(":")) ?? "—"}</span>
            <span>Sunucu portu: {status.listen.port}</span>
          </div>
          <p className="text-sm">
            {status.exposed
              ? "Sunucu tailnet’e açık. Aynı Tailscale hesabındaki bilgisayarlar şu adresle bağlanır: "
              : "Sunucu yalnızca bu bilgisayardan erişilebilir. Başka bir PC veya VPS’in bağlanabilmesi için tailnet’e aç."}
            {status.address && <strong className="break-all">{status.address}</strong>}
          </p>
          <Actions>
            <Button size="sm" isDisabled={busy} onPress={() => void toggle(!status.exposed)}>
              {status.exposed ? "Tailnet erişimini kapat" : "Tailnet’e aç"}
            </Button>
          </Actions>
          {status.peers.length > 0 && (
            <Disclose summary={"Tailnet’teki cihazlar (" + status.peers.length + ")"}>
              <ul className="text-sm">
                {status.peers.map((peer) => (
                  <li key={peer.ip}>
                    {peer.name} · {peer.ip} · {peer.os || "bilinmiyor"} · {peer.online ? "çevrimiçi" : "çevrimdışı"}
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
    <Disclose summary="Uzak Windows PC veya VPS için komutlar">
      {!address ? (
        <p className="text-sm text-muted">
          Önce Sunucular bölümünde Ağ erişimi altından bu sunucuyu tailnet’e aç. Uzak bilgisayar sunucuya bu adresle bağlanır.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Uzak bilgisayarda yönetici PowerShell aç ve sırayla çalıştır. İkinci komut kayıt anahtarını tüketir.</p>
          <Code>{"irm " + INSTALLER + " -OutFile $env:TEMP\\install-dots-worker.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-dots-worker.ps1 -ServerAddress " + address.hostname + " -ServerPort " + (address.port || "80")}</Code>
          <Code>{"C:\\Dots\\start-worker.cmd --enrollment " + token}</Code>
        </div>
      )}
    </Disclose>
  );
}

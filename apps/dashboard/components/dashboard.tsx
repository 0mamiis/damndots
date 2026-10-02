"use client";
import { Button, Card, Chip, Drawer, Separator, Alert } from "@heroui/react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { Overview, RuntimeEvent } from "@dots/contracts";
import {
  ApiContext,
  api,
  Empty,
  Field,
  Form,
  Loading,
  Notice,
  PageHeading,
  Row,
  saved,
  Section,
  Status,
  str,
  time,
  useData,
  newest,
} from "./ui";
import { DotPanel, TaskPanel } from "./runtime-panels";
import {
  MemoryPanel,
  SchedulePanel,
  OutputsPanel,
  ApprovalPanel,
} from "./resource-panels";
import {
  ComputerPanel,
  ConnectorPanel,
  SettingsPanel,
  VoicePanel,
} from "./system-panels";
import { ThemeToggle } from "./theme";
import {ConnectionPanel} from './connection-panel';
import {
  ClockIcon,
  ComputerIcon,
  DotIcon,
  DownloadIcon,
  GearIcon,
  HomeIcon,
  LogoutIcon,
  MemoryIcon,
  MenuIcon,
  MicIcon,
  PlugIcon,
  RefreshIcon,
  ShieldIcon,
  TaskIcon,
} from "./icons";

type PageKey =
  | "overview"
  | "dots"
  | "tasks"
  | "outputs"
  | "memories"
  | "schedules"
  | "computers"
  | "connectors"
  | "approvals"
  | "voice"
  | "servers"
  | "settings";
// Local host management remains available when the data backend is remote.
const pages: [PageKey, string, ReactElement][] = [
  ["overview", "Genel bakış", <HomeIcon key="i" />],
  ["dots", "Dot’lar", <DotIcon key="i" />],
  ["tasks", "Görevler", <TaskIcon key="i" />],
  ["outputs", "Çıktılar", <DownloadIcon key="i" />],
  ["memories", "Hafıza", <MemoryIcon key="i" />],
  ["schedules", "Zamanlama", <ClockIcon key="i" />],
  ["computers", "Bilgisayarlar", <ComputerIcon key="i" />],
  ["servers", "Sunucular", <PlugIcon key="host" />],
  ["connectors", "Bağlantılar", <PlugIcon key="i" />],
  ["approvals", "Onaylar", <ShieldIcon key="i" />],
  ["voice", "Ses", <MicIcon key="i" />],
  ["settings", "Ayarlar", <GearIcon key="i" />],
];
const isPage = (value: string): value is PageKey =>
  pages.some(([key]) => key === value);

function Brand() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full bg-accent/15"
      >
        <span className="size-2.5 rounded-full bg-accent" />
      </span>
      damndots
    </span>
  );
}

function Nav({
  page,
  onSelect,
}: {
  page: PageKey;
  onSelect: (page: PageKey) => void;
}) {
  return (
    <nav aria-label="Ana menü" className="flex flex-col gap-1">
      {pages.map(([key, label, icon]) => (
        <Button
          key={key}
          fullWidth
          variant={page === key ? "secondary" : "ghost"}
          className="justify-start"
          aria-current={page === key ? "page" : undefined}
          onPress={() => onSelect(key)}
        >
          {icon}
          {label}
        </Button>
      ))}
    </nav>
  );
}

export function Dashboard({
  connected: initialConnected,
  serverLabel: initialLabel,
  defaultServer = "http://127.0.0.1:9340",
  serverLocked = false,
}: {
  connected: boolean;
  serverLabel: string;
  defaultServer?: string;
  serverLocked?: boolean;
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [serverLabel, setServerLabel] = useState(initialLabel);
  const [page, setPageState] = useState<PageKey>("overview");
  const [revision, setRevision] = useState(0);
  const [eventState, setEventState] = useState("Bağlanıyor");
  const [menu, setMenu] = useState(false);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const setPage = useCallback((next: PageKey) => {
    setPageState(next);
    setMenu(false);
    if (typeof window !== "undefined" && window.location.hash !== `#${next}`)
      window.history.replaceState(null, "", `#${next}`);
  }, []);
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      if (isPage(hash)) setPageState(hash);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const mutate = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const value = await api<unknown>(path, {
        method,
        headers:
          body === undefined || body instanceof FormData
            ? undefined
            : { "content-type": "application/json" },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      refresh();
      saved("Değişiklik sunucuya kaydedildi.");
      return value;
    },
    [refresh],
  );
  useEffect(() => {
    if (!connected) return;
    const events = new EventSource("/api/backend/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.onopen = () => setEventState("Canlı");
    const update = () => {
      if (!timer)
        timer = setTimeout(() => {
          refresh();
          timer = undefined;
        }, 600);
    };
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RuntimeEvent;
        if (payload.type) update();
      } catch {}
    };
    const types = [
      "task.created",
      "task.updated",
      "task.completed",
      "task.failed",
      "task.cancelled",
      "task.delta",
      "activity.created",
      "message.created",
      "message.delta",
      "dot.created",
      "dot.updated",
      "dot.deleted",
      "approval.created",
      "approval.updated",
      "approval.resolved",
      "memory.created",
      "memory.updated",
      "memory.deleted",
      "schedule.created",
      "schedule.deleted",
      "output.created",
      "schedule.updated",
      "connector.reply.updated",
    ];
    for (const type of types) events.addEventListener(type, update);
    events.onerror = () => setEventState("Yeniden bağlanıyor");
    const fallback = setInterval(refresh, 15000);
    return () => {
      events.close();
      clearInterval(fallback);
      if (timer) clearTimeout(timer);
    };
  }, [connected, refresh]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);
  if (!connected)
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-10 px-6 py-10 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Brand />
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">
            Senin sunucun · Senin Dot’un
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Bir noktayla
            <br />
            başlayalım.
          </h1>
          <p className="max-w-md text-muted">
            Görevlerini, hafızanı ve bilgisayarlarını tek bir çalışma alanında
            buluştur.
          </p>
        </div>
        <Card className="gap-4 p-6">
          <Card.Header>
            <Card.Title
              className="text-xl"
              render={(props) => <h2 {...props} />}
            >
              Çalışma alanına bağlan
            </Card.Title>
            <Card.Description>
              Dots sunucun bu bilgisayarda veya uzak bir makinede çalışabilir.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <Form
              submit="Sunucuya bağlan"
              onSubmit={async (data) => {
                const response = await fetch("/api/session", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    serverUrl: str(data, "serverUrl"),
                    token: str(data, "token"),
                  }),
                });
                const value = await response.json();
                if (!response.ok) throw new Error(value.error);
                setServerLabel(value.server);
                setConnected(true);
              }}
            >
              <Field
                label="Sunucu adresi"
                name="serverUrl"
                type="url"
                value={defaultServer}
                required
                description={
                  serverLocked
                    ? "Bu panel yalnızca yöneticinin yapılandırdığı sunucuya bağlanır."
                    : "Uzak sunucularda HTTPS kullanın; SSH tüneli için localhost adresi."
                }
              />
              <Field
                label="Yönetici erişim anahtarı"
                name="token"
                type="password"
                required
                description="Sunucu kurulumunda oluşturulan erişim anahtarı."
              />
            </Form>
            <p className="text-xs text-muted">
              Oturum bilgilerin bu tarayıcının güvenli sunucu oturumunda
              tutulur.
            </p>
          </Card.Content>
        </Card>
      </main>
    );
  const title = pages.find((p) => p[0] === page)?.[1];
  return (
    <ApiContext.Provider value={{ revision, mutate, serverUrl: serverLabel }}>
      <a
        href="#content"
        className="sr-only z-50 rounded-xl bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Ana içeriğe geç
      </a>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-border bg-surface p-4 lg:flex">
          <a
            href="#overview"
            aria-label="Genel bakışa git"
            className="rounded-xl px-2 py-1"
            onClick={(e) => {
              e.preventDefault();
              setPage("overview");
            }}
          >
            <Brand />
          </a>
          <div className="flex flex-col gap-0.5 rounded-2xl bg-surface-secondary px-3 py-2">
            <span className="text-[11px] font-semibold tracking-widest text-muted uppercase">
              Çalışma alanı
            </span>
            <span
              className="truncate text-sm font-medium"
              title={serverLabel}
            >
              {serverLabel.replace(/^https?:\/\//, "")}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Nav page={page} onSelect={setPage} />
          </div>
          <Separator />
          <Button
            variant="ghost"
            className="justify-start"
            onPress={async () => {
              await fetch("/api/session", { method: "DELETE" });
              setConnected(false);
            }}
          >
            <LogoutIcon />
            Oturumu kapat
          </Button>
        </aside>
        <Drawer isOpen={menu} onOpenChange={setMenu}>
          <Drawer.Backdrop>
            <Drawer.Content placement="left">
              <Drawer.Dialog aria-label="Ana menü">
                <Drawer.CloseTrigger />
                <Drawer.Header>
                  <Drawer.Heading>
                    <Brand />
                  </Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <Nav page={page} onSelect={setPage} />
                </Drawer.Body>
                <Drawer.Footer>
                  <Button
                    variant="ghost"
                    onPress={async () => {
                      await fetch("/api/session", { method: "DELETE" });
                      setConnected(false);
                      setMenu(false);
                    }}
                  >
                    <LogoutIcon />
                    Oturumu kapat
                  </Button>
                </Drawer.Footer>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur sm:px-6">
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="lg:hidden"
              aria-label="Menüyü aç"
              onPress={() => setMenu(true)}
            >
              <MenuIcon />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-muted">
              Dots / <strong className="text-foreground">{title}</strong>
            </span>
            <Chip
              size="sm"
              variant="soft"
              color={
                eventState === "Canlı"
                  ? "success"
                  : eventState === "Bağlanıyor"
                    ? "default"
                    : "warning"
              }
            >
              {eventState}
            </Chip>
            <ThemeToggle />
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="Yenile"
              onPress={refresh}
            >
              <RefreshIcon />
            </Button>
          </header>
          <main
            id="content"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 outline-none sm:px-6"
          >
            {page === "overview" ? (
              <OverviewPanel />
            ) : page === "dots" ? (
              <DotPanel />
            ) : page === "tasks" ? (
              <TaskPanel />
            ) : page === "outputs" ? (
              <OutputsPanel />
            ) : page === "memories" ? (
              <MemoryPanel />
            ) : page === "schedules" ? (
              <SchedulePanel />
            ) : page === "approvals" ? (
              <ApprovalPanel />
            ) : page === "computers" ? (
              <ComputerPanel />
            ) : page === "servers" ? (
              <ConnectionPanel />
            ) : page === "connectors" ? (
              <ConnectorPanel />
            ) : page === "settings" ? (
              <SettingsPanel />
            ) : (
              <VoicePanel />
            )}
          </main>
          <footer className="flex items-center gap-2 px-6 py-4 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-success" />
            Dots kendi sunucunda çalışıyor.
          </footer>
        </div>
      </div>
    </ApiContext.Provider>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Card className="gap-1">
      <Card.Content className="flex flex-col gap-1">
        <strong className="text-3xl font-semibold tabular-nums">{value}</strong>
        <span className="text-sm text-muted">{label}</span>
      </Card.Content>
    </Card>
  );
}

function OverviewPanel() {
  const { data, error, loading } = useData<Overview>("overview");
  if (loading && !data) return <Loading />;
  if (error) return <Notice error={error} />;
  if (!data) return null;
  const active = data.tasks.filter((task) =>
    ["running", "queued", "waiting_approval"].includes(task.status),
  );
  return (
    <>
      <PageHeading
        eyebrow="Çalışma alanının nabzı"
        title="Bugün ne yapıyoruz?"
        description="Dot’larının son hareketleri, gerçek görevler ve çıktılar."
      />
      {data.pendingApprovals > 0 && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {data.pendingApprovals} işlem onayını bekliyor
            </Alert.Title>
            <Alert.Description>
              Onaylar bölümünden incele; Dot’un ilerlemesi karara bağlı.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat value={data.dots.length} label="Dot" />
        <Stat value={active.length} label="Etkin görev" />
        <Stat value={data.pendingApprovals} label="Bekleyen onay" />
        <Stat
          value={data.computers.filter((c) => c.state === "online").length}
          label="Çevrimiçi bilgisayar"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Şimdi çalışanlar"
          description="Kuyruktaki ve devam eden görevler"
        >
          {!active.length ? (
            <Empty>
              Etkin görev yok. Dot’lar bölümünden bir mesajla başlayın.
            </Empty>
          ) : (
            active.map((task) => (
              <Row key={task.id}>
                <div className="flex min-w-0 flex-col">
                  <strong className="truncate">{task.title}</strong>
                  <small className="text-muted">
                    {data.dots.find((d) => d.id === task.dotId)?.name ??
                      task.dotId}
                  </small>
                </div>
                <Status value={task.status} />
              </Row>
            ))
          )}
        </Section>
        <Section
          title="Dot’ların"
          description="Seninle çalışan kalıcı yardımcılar"
        >
          {!data.dots.length ? (
            <Empty>
              İlk Dot’unu oluştur; ona bir ad ve çalışma talimatı ver.
            </Empty>
          ) : (
            data.dots.map((dot) => (
              <Row key={dot.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 font-semibold text-accent"
                  >
                    {dot.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <strong className="truncate">{dot.name}</strong>
                    <small className="truncate text-muted">
                      {dot.model ?? "Varsayılan model"}
                    </small>
                  </div>
                </div>
                <Status value={dot.paused ? "paused" : "ready"} />
              </Row>
            ))
          )}
        </Section>
      </div>
      <Section
        title="Son hareketler"
        description="Sunucudan kaydedilen gerçek etkinlikler"
      >
        {!data.activity.length ? (
          <Empty>Henüz bir hareket kaydedilmedi.</Empty>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {newest(data.activity)
              .slice(0, 20)
              .map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-4 py-2.5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="break-words">{item.message}</span>
                    <small className="text-muted">
                      {item.type} ·{" "}
                      {data.dots.find((d) => d.id === item.dotId)?.name ??
                        "Dot"}
                    </small>
                  </div>
                  <time className="shrink-0 text-xs text-muted">
                    {time(item.createdAt)}
                  </time>
                </li>
              ))}
          </ol>
        )}
      </Section>
      <Section title="Son çıktılar">
        {!data.outputs.length ? (
          <Empty>Görevlerin ürettiği dosyalar burada görünecek.</Empty>
        ) : (
          newest(data.outputs)
            .slice(0, 6)
            .map((output) => (
              <Row key={output.id}>
                <div className="flex min-w-0 flex-col">
                  <strong className="truncate">{output.name}</strong>
                  <small className="text-muted">
                    {output.mimeType} · {Math.ceil(output.size / 1024)} KB
                  </small>
                </div>
                <a
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                  href={`/api/backend/outputs/${encodeURIComponent(output.id)}/content`}
                  download
                >
                  İndir
                </a>
              </Row>
            ))
        )}
      </Section>
    </>
  );
}

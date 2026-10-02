"use client";
import Image from "next/image";
import { Button } from "@heroui/react";
import { useContext, useEffect, useRef, useState } from "react";
import type {
  ApiList,
  Computer,
  Connector,
  Settings,
  ToolDefinition,
  ReplyOutbox,
} from "@dots/contracts";
import { ModelPicker, ProvidersPanel } from "./model-panels";
import {
  Action,
  Actions,
  ApiContext,
  api,
  Check,
  Code,
  ControlledField,
  Disclose,
  Empty,
  Field,
  Form,
  FormGrid,
  Json,
  Loading,
  Notice,
  PageHeading,
  Row,
  Section,
  SelectField,
  Status,
  Tags,
  str,
  nullable,
  time,
  useData,
} from "./ui";
import { CloseIcon, PlusIcon } from "./icons";
type BrowserJob = {
  id: string;
  status: string;
  error?: string;
  result: null | {
    sessionId: string;
    url: string;
    title: string;
    screenshotId?: string;
    width?: number;
    height?: number;
    control: "agent" | "user";
  };
};
const browserSessions = new Map<string, NonNullable<BrowserJob["result"]>>();
const connectorScopes: Record<string, { read: string[]; send: string[] }> = {
  slack: { read: ["events:read", "history:read"], send: ["chat:write"] },
  teams: { read: ["messages:read"], send: ["messages:send"] },
  email: { read: ["mail:read"], send: ["mail:send"] },
  github: { read: ["repo:read"], send: ["issues:write"] },
  webhook: { read: ["webhook:receive"], send: ["webhook:send"] },
  mcp: { read: ["tools:read"], send: ["tools:call"] },
};

function OutboxPanel() {
  const outbox = useData<ApiList<ReplyOutbox>>("connectors/outbox");
  return (
    <Section
      title="Kanal yanıtları"
      description="Gelen mesajlardan oluşan yanıtların gerçek gönderim durumu."
    >
      <Notice error={outbox.error} />
      {outbox.loading && !outbox.data ? (
        <Loading />
      ) : !outbox.data?.items.length ? (
        <Empty>Henüz kanal yanıtı yok.</Empty>
      ) : (
        outbox.data.items.map((reply) => (
          <Row key={reply.id} className="items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <strong className="break-all">Görev: {reply.taskId}</strong>
              <small className="text-muted">
                {reply.attempts} deneme · {time(reply.updatedAt)}
              </small>
              {reply.lastError && (
                <p className="text-sm text-danger" role="alert">
                  {reply.lastError}
                </p>
              )}
              {["failed", "delivery_unknown"].includes(reply.status) && (
                <Disclose summary="Yeniden gönderme">
                  <p className="text-sm text-muted">
                    Sağlayıcı mesajı daha önce almış olabilir. Yeniden denemeden
                    önce hedef kanalı kontrol edin. Yeni deneme ayrı bir onay
                    görevi oluşturur.
                  </p>
                  <Action
                    path={`connectors/outbox/${encodeURIComponent(reply.id)}/retry`}
                    variant="secondary"
                  >
                    Yeniden deneme görevi oluştur
                  </Action>
                </Disclose>
              )}
            </div>
            <Status value={reply.status} />
          </Row>
        ))
      )}
    </Section>
  );
}
export function ComputerPanel() {
  const computers = useData<ApiList<Computer>>("computers");
  const [enrollment, setEnrollment] = useState<{
    token: string;
    expiresAt: string;
    command: string;
  }>();
  const [selected, setSelected] = useState("");
  const [copyError, setCopyError] = useState("");
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="Dot’unun elleri"
        title="Bilgisayarlar"
        description="Bu bilgisayarı veya uzak bir yürütücüyü çalışma alanına bağla."
      />
      <Notice error={computers.error} />
      <Section
        title="Bilgisayar bağla"
        description="Worker, sunucuya dışarı doğru bağlantı kurar. Kaydı tamamlamak için komutu hedef bilgisayarda çalıştır."
      >
        <Form
          submit="Tek kullanımlık kayıt anahtarı oluştur"
          onSubmit={async (d) => {
            setEnrollment(
              (await mutate("computers/enrollment", "POST", {
                name: str(d, "name"),
              })) as typeof enrollment,
            );
          }}
        >
          <Field
            label="Bilgisayar adı"
            name="name"
            placeholder="Örn. Çalışma bilgisayarım"
          />
        </Form>
        {enrollment && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <p className="text-sm">
              Kayıt anahtarının son kullanımı: {time(enrollment.expiresAt)}
            </p>
            <Code>{enrollment.command}</Code>
            <Notice error={copyError} />
            <Actions>
              <Button
                variant="secondary"
                size="sm"
                onPress={async () => {
                  setCopyError("");
                  try {
                    await navigator.clipboard.writeText(enrollment.command);
                  } catch {
                    setCopyError("Komut kopyalanamadı. Metni seçip elle kopyalayın.");
                  }
                }}
              >
                Komutu kopyala
              </Button>
            </Actions>
            <Disclose summary="Kayıt anahtarı">
              <Code>{enrollment.token}</Code>
            </Disclose>
          </div>
        )}
      </Section>
      {computers.loading && !computers.data ? (
        <Loading />
      ) : !computers.data?.items.length ? (
        <Empty>
          Bağlı bilgisayar yok. Bir kayıt anahtarı oluştur ve worker komutunu
          çalıştır.
        </Empty>
      ) : (
        computers.data.items.map((computer) => (
          <Section
            key={computer.id}
            title={computer.name}
            description={`${computer.platform} · Son görülme ${time(computer.lastSeenAt)}`}
            action={<Status value={computer.state} />}
          >
            <Tags items={computer.capabilities} />
            <p className="text-sm text-muted">
              Çalışma kökleri: {computer.roots.join(", ") || "Kök seçilmemiş"}
            </p>
            <Actions>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={
                  computer.state !== "online" ||
                  !computer.capabilities.includes("browser")
                }
                onPress={() =>
                  setSelected(selected === computer.id ? "" : computer.id)
                }
              >
                Tarayıcıyı aç
              </Button>
            </Actions>
            <Disclose summary="Bağlantıyı kaldır">
              <p className="text-sm text-muted">
                Bu bilgisayarın erişimi iptal edilir.
              </p>
              <Action
                path={`computers/${computer.id}`}
                method="DELETE"
                variant="danger"
              >
                Erişimi kaldır
              </Action>
            </Disclose>
            {selected === computer.id && <BrowserControl computer={computer} />}
          </Section>
        ))
      )}
    </>
  );
}
const keys = ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp", "Control+A"];
function BrowserControl({ computer }: { computer: Computer }) {
  const [result, setResult] = useState<BrowserJob["result"]>(
    () => browserSessions.get(computer.id) ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [url, setUrl] = useState(browserSessions.get(computer.id)?.url ?? "");
  const [text, setText] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function execute(action: string, extra: Record<string, unknown> = {}) {
    setPending(true);
    setError("");
    try {
      let job = await api<BrowserJob>(`computers/${computer.id}/browser`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: result?.sessionId, action, ...extra }),
      });
      const deadline = Date.now() + 60000;
      while (["queued", "running"].includes(job.status) && alive.current) {
        if (Date.now() > deadline)
          throw new Error(
            "Tarayıcı işi hâlâ sürüyor. Bilgisayarın çevrimiçi olduğunu kontrol edin.",
          );
        await new Promise((resolve) => setTimeout(resolve, 650));
        job = await api<BrowserJob>(`browser/jobs/${job.id}`);
      }
      if (["failed", "cancelled"].includes(job.status))
        throw new Error(job.error ?? "Tarayıcı işi başarısız.");
      if (job.result && job.status === "completed") {
        if (action === "close") browserSessions.delete(computer.id);
        else browserSessions.set(computer.id, job.result);
        if (alive.current) {
          setResult(job.result);
          if (job.result.url) setUrl(job.result.url);
        }
      }
      return true;
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Tarayıcı işlemi başarısız.");
      return false;
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const mine = result?.control === "user";
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Tarayıcı kontrolü</h3>
          <p className="text-sm text-muted">
            {result?.title ?? "Yeni ve yalıtılmış tarayıcı oturumu"}
          </p>
        </div>
        {result && <Status value={result.control} />}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(result ? "navigate" : "open", { url });
        }}
      >
        <div className="min-w-60 flex-1">
          <ControlledField
            label="Tarayıcı adresi"
            type="url"
            required
            placeholder="https://example.com"
            value={url}
            onChange={setUrl}
          />
        </div>
        <Button type="submit" isPending={pending}>
          {result ? "Git" : "Oturumu aç"}
        </Button>
      </form>
      <Notice error={error} />
      {result && (
        <>
          <Actions>
            <Button
              size="sm"
              variant={mine ? "primary" : "secondary"}
              isPending={pending}
              onPress={() => execute(mine ? "release" : "takeover")}
            >
              {mine ? "Dot’a geri ver" : "Kontrolü devral"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={pending}
              onPress={() => execute("screenshot")}
            >
              Görüntüyü yenile
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={pending}
              onPress={async () => {
                if (await execute("close")) setResult(null);
              }}
            >
              Oturumu kapat
            </Button>
          </Actions>
          <p className="text-sm text-muted">
            {mine
              ? "Kontrol sende. Görüntüde bir noktaya tıklayabilir, yazabilir veya tuş gönderebilirsin."
              : "Kontrolü devraldığında Dot’un tarayıcı işlemleri durdurulur."}
          </p>
          {result.screenshotId ? (
            <button
              className="overflow-hidden rounded-2xl border border-border outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent enabled:cursor-crosshair disabled:opacity-80"
              aria-label="Tarayıcı görüntüsü; seçtiğin noktaya tıkla"
              disabled={pending || !mine}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                void execute("click", {
                  x: Math.round(
                    ((event.clientX - bounds.left) * (result.width ?? 1280)) /
                      bounds.width,
                  ),
                  y: Math.round(
                    ((event.clientY - bounds.top) * (result.height ?? 720)) /
                      bounds.height,
                  ),
                });
              }}
            >
              <Image
                src={`/api/backend/browser/screenshots/${result.screenshotId}`}
                width={result.width ?? 1280}
                height={result.height ?? 720}
                alt="Bağlı bilgisayarın tarayıcı görüntüsü"
                unoptimized
                className="h-auto w-full"
              />
            </button>
          ) : (
            <Empty>Henüz ekran görüntüsü yok. Görüntüyü yenile.</Empty>
          )}
          <Form
            submit="Metni yaz"
            disabled={pending || !mine}
            onSubmit={async () => {
              if (await execute("type", { text })) setText("");
            }}
          >
            <ControlledField
              label="Odaklanan alana yazılacak metin"
              name="text"
              value={text}
              onChange={setText}
              required
            />
            <SelectField
              label="Tuş"
              value=""
              placeholder="Tuş gönder…"
              disabled={pending || !mine}
              onChange={(key) => {
                if (key) void execute("press", { key });
              }}
              options={keys.map((key) => ({ value: key, label: key }))}
            />
          </Form>
        </>
      )}
    </div>
  );
}
export function ConnectorPanel() {
  const connectors = useData<ApiList<Connector>>("connectors");
  const [edit, setEdit] = useState<Connector | null | undefined>();
  const [connectorKind, setConnectorKind] = useState("mcp");
  const [selected, setSelected] = useState("");
  const [testResult, setTestResult] = useState<unknown>();
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState("");
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="Dış dünyayla bağlantı"
        title="Bağlantılar"
        description="Okuma ve gönderme yetkilerini ayrı ayrı seç; araçları keşfet."
        action={
          <Button
            onPress={() => {
              setEdit(null);
              setConnectorKind("mcp");
            }}
          >
            <PlusIcon />
            Bağlantı ekle
          </Button>
        }
      />
      <Notice error={connectors.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Bağlantıyı düzenle" : "Yeni bağlantı"}
          action={
            <Button size="sm" variant="ghost" onPress={() => setEdit(undefined)}>
              <CloseIcon width={14} height={14} />
              Kapat
            </Button>
          }
        >
          <Form
            key={edit?.id ?? "new"}
            onDone={() => setEdit(undefined)}
            onSubmit={(d) => {
              const config = JSON.parse(str(d, "config") || "{}");
              if (!config || Array.isArray(config) || typeof config !== "object")
                throw new Error("Yapılandırma bir JSON nesnesi olmalı.");
              const kind = edit?.kind ?? str(d, "kind");
              return mutate(
                edit ? `connectors/${edit.id}` : "connectors",
                edit ? "PATCH" : "POST",
                {
                  kind,
                  name: str(d, "name"),
                  config,
                  scopes: [
                    ...(d.has("read") ? connectorScopes[kind].read : []),
                    ...(d.has("send") ? connectorScopes[kind].send : []),
                  ],
                  enabled: d.has("enabled"),
                },
              );
            }}
          >
            <FormGrid>
              <Field label="Ad" name="name" value={edit?.name} required />
              <SelectField
                label="Bağlantı türü"
                name="kind"
                value={connectorKind}
                onChange={setConnectorKind}
                disabled={Boolean(edit)}
                options={["mcp", "slack", "teams", "email", "github", "webhook"].map(
                  (kind) => ({ value: kind, label: kind }),
                )}
              />
            </FormGrid>
            <Field
              label="Sağlayıcı yapılandırması (JSON)"
              name="config"
              type="textarea"
              value={JSON.stringify(
                edit
                  ? Object.fromEntries(
                      Object.entries(edit.config).filter(
                        ([, value]) =>
                          value !== "[REDACTED]" &&
                          value !== "[redacted]" &&
                          value !== "***",
                      ),
                    )
                  : {},
                null,
                2,
              )}
              required
              description="Sağlayıcının URL ve erişim bilgilerini girin. Kayıtlı sırlar gösterilmez; mevcut sırları değiştirmek için yeni değer girin."
            />
            <Check
              name="read"
              label={
                connectorKind === "mcp"
                  ? "Araç listesini okumaya izin ver"
                  : "Okuma araçlarına izin ver"
              }
              checked={
                edit
                  ? connectorScopes[edit.kind].read.some((scope) =>
                      edit.scopes.includes(scope),
                    )
                  : true
              }
            />
            <Check
              name="send"
              label={
                connectorKind === "mcp"
                  ? "Araçları çalıştırmaya izin ver (yazma işlemleri onay ister)"
                  : "Gönderme araçlarına izin ver (onay akışına tabi)"
              }
              checked={
                edit
                  ? connectorScopes[edit.kind].send.some((scope) =>
                      edit.scopes.includes(scope),
                    )
                  : false
              }
            />
            <Check
              name="enabled"
              label="Bağlantı etkin"
              checked={edit?.enabled ?? true}
            />
            <Disclose summary="Kurulum örnekleri">
              <p className="text-sm text-muted">
                MCP: url, headers. Slack: botToken, signingSecret. Email:
                SMTP/IMAP sunucusu ve kimlik bilgileri. GitHub: token. Teams ve
                webhook kurulumunun ayrıntıları docs/INTEGRATIONS.md dosyasında.
              </p>
            </Disclose>
          </Form>
        </Section>
      )}
      <Notice error={testError} />
      {testResult !== undefined && (
        <Section title="Bağlantı testinin yanıtı">
          <Json value={testResult} />
        </Section>
      )}
      {connectors.loading && !connectors.data ? (
        <Loading />
      ) : !connectors.data?.items.length ? (
        <Empty>
          Henüz bağlantı yok. Kullanacağın hizmeti ekle ve yetkilerini seç.
        </Empty>
      ) : (
        connectors.data.items.map((connector) => (
          <Section
            key={connector.id}
            title={connector.name}
            description={`${connector.kind} · ${connector.scopes.join(", ") || "Yetki verilmemiş"}`}
            action={<Status value={connector.state} />}
          >
            <Notice error={connector.lastError ?? ""} />
            <Actions>
              <Button
                size="sm"
                variant="secondary"
                isPending={testing === connector.id}
                onPress={async () => {
                  setTesting(connector.id);
                  setTestError("");
                  try {
                    setTestResult(await mutate(`connectors/${connector.id}/test`, "POST"));
                  } catch (e) {
                    setTestError(e instanceof Error ? e.message : "Test başarısız.");
                  } finally {
                    setTesting("");
                  }
                }}
              >
                Bağlantıyı test et
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  setSelected(selected === connector.id ? "" : connector.id)
                }
              >
                Araçları keşfet
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setEdit(connector);
                  setConnectorKind(connector.kind);
                }}
              >
                Düzenle
              </Button>
              <Action
                path={`connectors/${connector.id}`}
                method="PATCH"
                body={{ enabled: !connector.enabled }}
              >
                {connector.enabled ? "Devre dışı bırak" : "Etkinleştir"}
              </Action>
              <Action path={`connectors/${connector.id}`} method="DELETE" variant="ghost">
                Sil
              </Action>
            </Actions>
            {selected === connector.id && <ToolPanel connector={connector} />}
          </Section>
        ))
      )}
      <OutboxPanel />
    </>
  );
}
function ToolPanel({ connector }: { connector: Connector }) {
  const tools = useData<ApiList<ToolDefinition> | ToolDefinition[]>(
    `connectors/${connector.id}/tools`,
  );
  const { mutate } = useContext(ApiContext);
  const [result, setResult] = useState<unknown>();
  const items = Array.isArray(tools.data) ? tools.data : tools.data?.items;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <Notice error={tools.error} />
      {tools.loading ? (
        <Loading />
      ) : !items?.length ? (
        <Empty>Bu bağlantı kullanılabilir araç döndürmedi.</Empty>
      ) : (
        items.map((tool) => (
          <Disclose key={tool.name} summary={`${tool.name} — ${tool.description}`}>
            <Json value={tool.inputSchema} />
            <Form
              submit="Aracı çalıştır"
              onSubmit={async (d) => {
                setResult(
                  await mutate(
                    `connectors/${connector.id}/tools/${encodeURIComponent(tool.name)}/call`,
                    "POST",
                    { arguments: JSON.parse(str(d, "arguments")) },
                  ),
                );
              }}
            >
              <Field
                label="Araç parametreleri (JSON)"
                name="arguments"
                type="textarea"
                value="{}"
                required
              />
            </Form>
          </Disclose>
        ))
      )}
      {result !== undefined && (
        <>
          <h3 className="font-semibold">Araç isteğinin yanıtı</h3>
          <p className="text-sm text-muted">
            Görev oluşturulduysa sonucu Görevler bölümünde izleyin.
          </p>
          <Json value={result} />
        </>
      )}
    </div>
  );
}
export function SettingsPanel() {
  const settings = useData<Settings>("settings");
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="Çalışma biçimin"
        title="Ayarlar"
        description="Modeli ve sunucunun görev davranışını seç."
      />
      <Notice error={settings.error} />
      <ProvidersPanel />
      {settings.loading && !settings.data ? (
        <Loading />
      ) : (
        settings.data && (
          <Section title="Sunucu ayarları">
            <Form
              key={JSON.stringify(settings.data)}
              onSubmit={(d) =>
                mutate("settings", "PATCH", {
                  appServerUrl: str(d, "appServerUrl"),
                  model: nullable(d, "model"),
                  reasoningEffort: str(d, "reasoningEffort") || undefined,
                  serviceTier: nullable(d, "serviceTier"),
                  maxParallelTasks: Number(str(d, "maxParallelTasks")),
                  proactiveEnabled: d.has("proactiveEnabled"),
                  autoApproveExecution: d.has("autoApproveExecution"),
                })
              }
            >
              <FormGrid>
                <Field
                  label="Codex uygulama sunucusu"
                  name="appServerUrl"
                  value={settings.data.appServerUrl}
                  required
                  description="Sunucunun Codex app-server bağlantı adresi."
                />
                <Field
                  label="Eşzamanlı görev sınırı"
                  name="maxParallelTasks"
                  type="number"
                  value={settings.data.maxParallelTasks}
                  required
                />
              </FormGrid>
              <FormGrid>
                <ModelPicker
                  model={settings.data.model}
                  reasoningEffort={settings.data.reasoningEffort}
                  serviceTier={settings.data.serviceTier}
                  blankLabel="Sunucu varsayılanı"
                />
              </FormGrid>
              <Check
                name="autoApproveExecution"
                label="Tam erişim — komut onayı isteme"
                checked={settings.data.autoApproveExecution ?? true}
              />
              <p className="text-sm text-muted">
                Açıkken Codex görevleri tam erişimle, onay istemeden çalışır. Gerçek kullanıcı soruları cevap gerektirir.
              </p>
              <Check
                name="proactiveEnabled"
                label="Proaktif çalışmaya izin ver"
                checked={settings.data.proactiveEnabled}
              />
              {settings.data.dataDirectory && (
                <p className="text-sm text-muted">
                  Veri dizini: {settings.data.dataDirectory}
                </p>
              )}
            </Form>
          </Section>
        )
      )}
    </>
  );
}
export function LegacyClientPairingPanel() {
  const { serverUrl, mutate } = useContext(ApiContext);
  const [enrollment, setEnrollment] = useState<{
    token: string;
    expiresAt: string;
    command: string;
  }>();
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    if (!enrollment) return;
    const remaining = new Date(enrollment.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => setEnrollment(undefined), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [enrollment]);
  const shellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return (
    <Section
      title="Eski izole istemci eşleştirmesi"
      description="Aynı bilgisayardan veya uzak sunucudan Dots’a bağlanan özel uygulama kopyası. Ana Codex yerine ayrı profil kullanır."
    >
      <p className="text-sm text-muted">
        Bağlanılacak sunucu: {serverUrl}. Komutu istemci bilgisayarda Dots proje
        klasöründe çalıştırın. Uzak sunucu için HTTPS veya localhost SSH tüneli
        kullanın.
      </p>
      <Form
        submit="İstemci kayıt komutunu oluştur"
        onSubmit={async (data) => {
          const port = Number(str(data, "port"));
          if (!Number.isInteger(port) || port < 1024 || port > 65535)
            throw new Error("1024 ile 65535 arasında boş bir yerel port seçin.");
          const value = (await mutate("clients/enrollment", "POST")) as {
            token: string;
            expiresAt: string;
          };
          if (
            !value ||
            typeof value.token !== "string" ||
            !Number.isFinite(new Date(value.expiresAt).getTime())
          )
            throw new Error("Sunucu geçerli bir istemci kayıt anahtarı döndürmedi.");
          setEnrollment({
            ...value,
            command: `npm run dev:client -- --server ${shellQuote(serverUrl)} --enrollment ${shellQuote(value.token)} --port ${port} --launch`,
          });
        }}
      >
        <Field
          label="İstemcinin yerel gateway portu"
          name="port"
          type="number"
          value={8001}
          required
          description="Bu bilgisayarda başka bir uygulamanın kullanmadığı port."
        />
      </Form>
      {enrollment && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="text-sm">
            Tek kullanımlık kayıt anahtarının son kullanımı:{" "}
            {time(enrollment.expiresAt)}. Komutu yalnız kendi istemci
            bilgisayarında kullan.
          </p>
          <Code>{enrollment.command}</Code>
          <Notice error={copyError} />
          <Actions>
            <Button
              variant="secondary"
              size="sm"
              onPress={async () => {
                setCopyError("");
                try {
                  await navigator.clipboard.writeText(enrollment.command);
                } catch {
                  setCopyError("Komut kopyalanamadı. Metni seçip elle kopyalayın.");
                }
              }}
            >
              Komutu kopyala
            </Button>
            <Button variant="ghost" size="sm" onPress={() => setEnrollment(undefined)}>
              Komutu gizle
            </Button>
          </Actions>
        </div>
      )}
    </Section>
  );
}
type VoiceSettings = {
  apiUrl?: string;
  apiKey?: string;
  transcriptionModel?: string;
  speechModel?: string;
  mode?: string;
  transcriptionMode?: string;
  language?: string;
  voice?: string;
  enabled?: boolean;
  followCodexVoice?: boolean;
  [key: string]: unknown;
};
export function VoicePanel() {
  const settings = useData<VoiceSettings>("voice/settings");
  const { mutate } = useContext(ApiContext);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [audioUrl, setAudioUrl] = useState("");
  useEffect(
    () => () => {
      recorder.current?.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  async function transcribe(blob: Blob, filename = "recording.webm") {
    setTranscribing(true);
    setError("");
    try {
      const form = new FormData();
      form.append("audio", blob, filename);
      const result = await api<{ text: string }>("voice/transcribe", {
        method: "POST",
        body: form,
      });
      setTranscript(result.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ses çözümlenemedi.");
    } finally {
      setTranscribing(false);
    }
  }
  async function record() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Mikrofon için HTTPS veya localhost kullanın.");
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const instance = new MediaRecorder(stream.current);
      instance.ondataavailable = (event) => chunks.push(event.data);
      instance.onstop = () => {
        stream.current?.getTracks().forEach((track) => track.stop());
        void transcribe(new Blob(chunks, { type: instance.mimeType }));
      };
      recorder.current = instance;
      instance.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mikrofona erişilemedi.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Konuşarak çalış"
        title="Ses"
        description="Sesini yazıya çevir veya AI tarafından oluşturulan bir sesi dinle."
      />
      <Section title="Ses çalışma alanı">
        <Notice error={error} />
        <Actions>
          <Button
            variant={recording ? "danger" : "primary"}
            isDisabled={transcribing}
            onPress={record}
          >
            {recording ? "Kaydı durdur" : "Mikrofondan kaydet"}
          </Button>
          <Button
            variant="secondary"
            isDisabled={transcribing || recording}
            onPress={() => picker.current?.click()}
          >
            Ses dosyası yükle
          </Button>
          <input
            ref={picker}
            type="file"
            accept="audio/*"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void transcribe(file, file.name);
              e.target.value = "";
            }}
          />
          <span role="status" className="text-sm text-muted">
            {transcribing
              ? "Ses yazıya çevriliyor…"
              : recording
                ? "Kayıt sürüyor…"
                : ""}
          </span>
        </Actions>
        <ControlledField
          label="Metin"
          value={transcript}
          onChange={setTranscript}
          rows={6}
          placeholder="Sesin çözümlendiğinde metin burada görünür."
        />
        <Form
          submit="Metni seslendir"
          onSubmit={async (d) => {
            const response = await fetch("/api/backend/voice/speak", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                text: transcript,
                ...(str(d, "voice") ? { voice: str(d, "voice") } : {}),
              }),
            });
            if (!response.ok) {
              const value = await response.json();
              throw new Error(value.error ?? "Ses oluşturulamadı.");
            }
            setAudioUrl(URL.createObjectURL(await response.blob()));
          }}
        >
          <Field
            label="Ses adı (isteğe bağlı)"
            name="voice"
            value={settings.data?.voice}
          />
        </Form>
        {audioUrl && (
          <audio controls src={audioUrl} className="w-full">
            Tarayıcınız ses oynatmayı desteklemiyor.
          </audio>
        )}
      </Section>
      <Section
        title="Ses sağlayıcısı"
        description="OpenAI uyumlu transkripsiyon ve seslendirme servisi. Ses AI ile oluşturulur."
      >
        <Notice error={settings.error} />
        {settings.loading && !settings.data ? (
          <Loading />
        ) : (
          <Form
            key={JSON.stringify(settings.data)}
            onSubmit={(d) =>
              mutate("voice/settings", "PATCH", {
                apiUrl: str(d, "apiUrl"),
                ...(str(d, "apiKey") ? { apiKey: str(d, "apiKey") } : {}),
                transcriptionModel: str(d, "transcriptionModel"),
                speechModel: str(d, "speechModel"),
                mode: str(d, "mode") || "auto",
                transcriptionMode: str(d, "transcriptionMode") || "auto",
                language: str(d, "language"),
                voice: str(d, "voice"),
                enabled: d.has("enabled"),
                followCodexVoice: d.has("followCodexVoice"),
              })
            }
          >
            <FormGrid>
              <Field
                label="Servis adresi"
                name="apiUrl"
                type="url"
                value={settings.data?.apiUrl}
                placeholder="https://api.openai.com/v1"
              />
              <Field
                label="Yeni API anahtarı"
                name="apiKey"
                type="password"
                description="Boş bırakıldığında kayıtlı anahtar korunur."
              />
              <Field
                label="Transkripsiyon modeli"
                name="transcriptionModel"
                value={settings.data?.transcriptionModel}
              />
              <Field
                label="Seslendirme modeli"
                name="speechModel"
                value={settings.data?.speechModel}
              />
              <Field
                label="Varsayılan ses"
                name="voice"
                value={settings.data?.voice}
              />
              <SelectField
                label="Arama modu"
                name="mode"
                defaultValue={settings.data?.mode ?? "auto"}
                description="Otomatik: OpenAI adresinde Realtime API, başka bir proxy adresinde konuşma → Dot modeli → seslendirme hattı."
                options={[
                  { value: "auto", label: "Otomatik" },
                  { value: "pipeline", label: "Proxy hattı (STT → model → TTS)" },
                  { value: "realtime", label: "OpenAI Realtime API" },
                ]}
              />
              <SelectField
                label="Transkripsiyon yöntemi"
                name="transcriptionMode"
                defaultValue={settings.data?.transcriptionMode ?? "auto"}
                description="Ses girdili bir sohbet modeli (ör. Gemini) seçiliyse “Sohbet modeli” kullanın."
                options={[
                  { value: "auto", label: "Otomatik" },
                  { value: "audio", label: "Ses API'si (/audio/transcriptions)" },
                  { value: "chat", label: "Sohbet modeli (ses girdili)" },
                ]}
              />
              <Field
                label="Konuşma dili"
                name="language"
                value={settings.data?.language}
                placeholder="tr"
              />
            </FormGrid>
            <Check
              name="enabled"
              label="Ses servisleri etkin"
              checked={settings.data?.enabled}
            />
            <Check
              name="followCodexVoice"
              label="Aramalarda Codex’te seçili sesi kullan"
              description="Açıkken cevaplar Codex uygulamasındaki ses ayarıyla okunur; kapalıyken yukarıdaki seslendirme modeli kullanılır."
              checked={settings.data?.followCodexVoice}
            />
          </Form>
        )}
      </Section>
    </>
  );
}

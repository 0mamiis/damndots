"use client";
import { RemoteInstall } from "./network-panel";
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
      title="Channel replies"
      description="The real delivery status of replies created from incoming messages."
    >
      <Notice error={outbox.error} />
      {outbox.loading && !outbox.data ? (
        <Loading />
      ) : !outbox.data?.items.length ? (
        <Empty>No channel replies yet.</Empty>
      ) : (
        outbox.data.items.map((reply) => (
          <Row key={reply.id} className="items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <strong className="break-all">Task: {reply.taskId}</strong>
              <small className="text-muted">
                {reply.attempts} attempts · {time(reply.updatedAt)}
              </small>
              {reply.lastError && (
                <p className="text-sm text-danger" role="alert">
                  {reply.lastError}
                </p>
              )}
              {["failed", "delivery_unknown"].includes(reply.status) && (
                <Disclose summary="Resend">
                  <p className="text-sm text-muted">
                    The provider may already have received the message. Check the target channel before retrying. A new attempt creates a separate approval task.
                  </p>
                  <Action
                    path={`connectors/outbox/${encodeURIComponent(reply.id)}/retry`}
                    variant="secondary"
                  >
                    Create a retry task
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
        eyebrow="Your Dot’s hands"
        title="Computers"
        description="Connect this computer or a remote executor to the workspace."
      />
      <Notice error={computers.error} />
      <Section
        title="Connect a computer"
        description="The worker makes an outbound connection to the server. Run the command on the target computer to finish enrollment."
      >
        <Form
          submit="Create a single-use enrollment key"
          onSubmit={async (d) => {
            setEnrollment(
              (await mutate("computers/enrollment", "POST", {
                name: str(d, "name"),
              })) as typeof enrollment,
            );
          }}
        >
          <Field
            label="Computer name"
            name="name"
            placeholder="e.g. My work computer"
          />
        </Form>
        {enrollment && (
          <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <p className="text-sm">
              Enrollment key valid until: {time(enrollment.expiresAt)}
            </p>
            <Code>{enrollment.command}</Code>
            <RemoteInstall token={enrollment.token} />
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
                    setCopyError("The command could not be copied. Select the text and copy it manually.");
                  }
                }}
              >
                Copy the command
              </Button>
            </Actions>
            <Disclose summary="Enrollment key">
              <Code>{enrollment.token}</Code>
            </Disclose>
          </div>
        )}
      </Section>
      {computers.loading && !computers.data ? (
        <Loading />
      ) : !computers.data?.items.length ? (
        <Empty>
          No computers connected. Create an enrollment key and run the worker command.
        </Empty>
      ) : (
        computers.data.items.map((computer) => (
          <Section
            key={computer.id}
            title={computer.name}
            description={`${computer.platform} · Last seen ${time(computer.lastSeenAt)}`}
            action={<Status value={computer.state} />}
          >
            <Tags items={computer.capabilities} />
            <p className="text-sm text-muted">
              Working roots: {computer.roots.join(", ") || "No root selected"}
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
                Open the browser
              </Button>
            </Actions>
            <Disclose summary="Disconnect">
              <p className="text-sm text-muted">
                This computer’s access will be revoked.
              </p>
              <Action
                path={`computers/${computer.id}`}
                method="DELETE"
                variant="danger"
              >
                Revoke access
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
            "The browser job is still running. Check that the computer is online.",
          );
        await new Promise((resolve) => setTimeout(resolve, 650));
        job = await api<BrowserJob>(`browser/jobs/${job.id}`);
      }
      if (["failed", "cancelled"].includes(job.status))
        throw new Error(job.error ?? "The browser job failed.");
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
        setError(e instanceof Error ? e.message : "The browser operation failed.");
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
          <h3 className="font-semibold">Browser control</h3>
          <p className="text-sm text-muted">
            {result?.title ?? "A new, isolated browser session"}
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
            label="Browser address"
            type="url"
            required
            placeholder="https://example.com"
            value={url}
            onChange={setUrl}
          />
        </div>
        <Button type="submit" isPending={pending}>
          {result ? "Go" : "Open session"}
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
              {mine ? "Give back to the Dot" : "Take over control"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={pending}
              onPress={() => execute("screenshot")}
            >
              Refresh the view
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={pending}
              onPress={async () => {
                if (await execute("close")) setResult(null);
              }}
            >
              Sign out
            </Button>
          </Actions>
          <p className="text-sm text-muted">
            {mine
              ? "You are in control. You can click a point in the view, type, or send keys."
              : "When you take control, the Dot’s browser actions are paused."}
          </p>
          {result.screenshotId ? (
            <button
              className="overflow-hidden rounded-2xl border border-border outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent enabled:cursor-crosshair disabled:opacity-80"
              aria-label="Browser view; click the point you want"
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
                alt="Browser view of the connected computer"
                unoptimized
                className="h-auto w-full"
              />
            </button>
          ) : (
            <Empty>No screenshot yet. Refresh the view.</Empty>
          )}
          <Form
            submit="Type the text"
            disabled={pending || !mine}
            onSubmit={async () => {
              if (await execute("type", { text })) setText("");
            }}
          >
            <ControlledField
              label="Text to type into the focused field"
              name="text"
              value={text}
              onChange={setText}
              required
            />
            <SelectField
              label="Key"
              value=""
              placeholder="Send key…"
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
        eyebrow="Connections to the outside world"
        title="Connections"
        description="Choose read and send permissions separately; discover tools."
        action={
          <Button
            onPress={() => {
              setEdit(null);
              setConnectorKind("mcp");
            }}
          >
            <PlusIcon />
            Add connection
          </Button>
        }
      />
      <Notice error={connectors.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Edit connection" : "New connection"}
          action={
            <Button size="sm" variant="ghost" onPress={() => setEdit(undefined)}>
              <CloseIcon width={14} height={14} />
              Close
            </Button>
          }
        >
          <Form
            key={edit?.id ?? "new"}
            onDone={() => setEdit(undefined)}
            onSubmit={(d) => {
              const config = JSON.parse(str(d, "config") || "{}");
              if (!config || Array.isArray(config) || typeof config !== "object")
                throw new Error("The configuration must be a JSON object.");
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
              <Field label="Name" name="name" value={edit?.name} required />
              <SelectField
                label="Connection type"
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
              label="Provider configuration (JSON)"
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
              description="Enter the provider’s URL and credentials. Stored secrets are not shown; enter a new value to replace an existing secret."
            />
            <Check
              name="read"
              label={
                connectorKind === "mcp"
                  ? "Allow reading the tool list"
                  : "Allow read tools"
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
                  ? "Allow running tools (write actions ask for approval)"
                  : "Allow send tools (subject to the approval flow)"
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
              label="Connection enabled"
              checked={edit?.enabled ?? true}
            />
            <Disclose summary="Setup examples">
              <p className="text-sm text-muted">
                MCP: url, headers. Slack: botToken, signingSecret. Email: SMTP/IMAP server and credentials. GitHub: token. Details for Teams and webhook setup are in docs/INTEGRATIONS.md.
              </p>
            </Disclose>
          </Form>
        </Section>
      )}
      <Notice error={testError} />
      {testResult !== undefined && (
        <Section title="Connection test response">
          <Json value={testResult} />
        </Section>
      )}
      {connectors.loading && !connectors.data ? (
        <Loading />
      ) : !connectors.data?.items.length ? (
        <Empty>
          No connections yet. Add the service you will use and choose its permissions.
        </Empty>
      ) : (
        connectors.data.items.map((connector) => (
          <Section
            key={connector.id}
            title={connector.name}
            description={`${connector.kind} · ${connector.scopes.join(", ") || "No permission granted"}`}
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
                    setTestError(e instanceof Error ? e.message : "Test failed.");
                  } finally {
                    setTesting("");
                  }
                }}
              >
                Test connection
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  setSelected(selected === connector.id ? "" : connector.id)
                }
              >
                Discover tools
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setEdit(connector);
                  setConnectorKind(connector.kind);
                }}
              >
                Edit
              </Button>
              <Action
                path={`connectors/${connector.id}`}
                method="PATCH"
                body={{ enabled: !connector.enabled }}
              >
                {connector.enabled ? "Disable" : "Enable"}
              </Action>
              <Action path={`connectors/${connector.id}`} method="DELETE" variant="ghost">
                Delete
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
        <Empty>This connection returned no usable tools.</Empty>
      ) : (
        items.map((tool) => (
          <Disclose key={tool.name} summary={`${tool.name} — ${tool.description}`}>
            <Json value={tool.inputSchema} />
            <Form
              submit="Run the tool"
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
                label="Tool parameters (JSON)"
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
          <h3 className="font-semibold">Tool request response</h3>
          <p className="text-sm text-muted">
            If a task was created, follow its result in the Tasks section.
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
        eyebrow="Your way of working"
        title="Settings"
        description="Choose the model and how the server handles tasks."
      />
      <Notice error={settings.error} />
      <ProvidersPanel />
      {settings.loading && !settings.data ? (
        <Loading />
      ) : (
        settings.data && (
          <Section title="Server settings">
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
                  label="Codex app server"
                  name="appServerUrl"
                  value={settings.data.appServerUrl}
                  required
                  description="The server’s Codex app-server connection address."
                />
                <Field
                  label="Concurrent task limit"
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
                  blankLabel="Server default"
                />
              </FormGrid>
              <Check
                name="autoApproveExecution"
                label="Full access — do not ask for command approval"
                checked={settings.data.autoApproveExecution ?? false}
              />
              <p className="text-sm text-muted">
                When on, Codex tasks run with full access without asking for approval. Real user questions still need an answer.
              </p>
              <Check
                name="proactiveEnabled"
                label="Allow proactive work"
                checked={settings.data.proactiveEnabled}
              />
              {settings.data.dataDirectory && (
                <p className="text-sm text-muted">
                  Data directory: {settings.data.dataDirectory}
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
      title="Legacy isolated client pairing"
      description="A separate app copy that connects to Dots from the same computer or a remote server. It uses its own profile rather than the main Codex."
    >
      <p className="text-sm text-muted">
        Server to connect to: {serverUrl}. Run the command in the Dots project folder on the client computer. For a remote server use HTTPS or a localhost SSH tunnel.
      </p>
      <Form
        submit="Create the client enrollment command"
        onSubmit={async (data) => {
          const port = Number(str(data, "port"));
          if (!Number.isInteger(port) || port < 1024 || port > 65535)
            throw new Error("Choose a free local port between 1024 and 65535.");
          const value = (await mutate("clients/enrollment", "POST")) as {
            token: string;
            expiresAt: string;
          };
          if (
            !value ||
            typeof value.token !== "string" ||
            !Number.isFinite(new Date(value.expiresAt).getTime())
          )
            throw new Error("The server did not return a valid client enrollment key.");
          setEnrollment({
            ...value,
            command: `npm run dev:client -- --server ${shellQuote(serverUrl)} --enrollment ${shellQuote(value.token)} --port ${port} --launch`,
          });
        }}
      >
        <Field
          label="The client’s local gateway port"
          name="port"
          type="number"
          value={8001}
          required
          description="A port no other application on this computer is using."
        />
      </Form>
      {enrollment && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="text-sm">
            Single-use enrollment key valid until:{" "}
            {time(enrollment.expiresAt)}. Use the command only on your own client computer.
          </p>
          <Code>{enrollment.command}</Code>
            <RemoteInstall token={enrollment.token} />
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
                  setCopyError("The command could not be copied. Select the text and copy it manually.");
                }
              }}
            >
              Copy the command
            </Button>
            <Button variant="ghost" size="sm" onPress={() => setEnrollment(undefined)}>
              Hide the command
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
      setError(e instanceof Error ? e.message : "The audio could not be transcribed.");
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
        throw new Error("Use HTTPS or localhost for the microphone.");
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
      setError(e instanceof Error ? e.message : "The microphone could not be accessed.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Work by speaking"
        title="Voice"
        description="Turn your voice into text, or listen to an AI-generated voice."
      />
      <Section title="Voice workspace">
        <Notice error={error} />
        <Actions>
          <Button
            variant={recording ? "danger" : "primary"}
            isDisabled={transcribing}
            onPress={record}
          >
            {recording ? "Stop recording" : "Record from the microphone"}
          </Button>
          <Button
            variant="secondary"
            isDisabled={transcribing || recording}
            onPress={() => picker.current?.click()}
          >
            Upload an audio file
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
              ? "Transcribing the audio…"
              : recording
                ? "Recording…"
                : ""}
          </span>
        </Actions>
        <ControlledField
          label="Text"
          value={transcript}
          onChange={setTranscript}
          rows={6}
          placeholder="Once your audio is transcribed, the text appears here."
        />
        <Form
          submit="Read the text aloud"
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
              throw new Error(value.error ?? "Audio could not be generated.");
            }
            setAudioUrl(URL.createObjectURL(await response.blob()));
          }}
        >
          <Field
            label="Voice name (optional)"
            name="voice"
            value={settings.data?.voice}
          />
        </Form>
        {audioUrl && (
          <audio controls src={audioUrl} className="w-full">
            Your browser does not support audio playback.
          </audio>
        )}
      </Section>
      <Section
        title="Voice provider"
        description="An OpenAI-compatible transcription and speech service. The voice is generated by AI."
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
                label="Service address"
                name="apiUrl"
                type="url"
                value={settings.data?.apiUrl}
                placeholder="https://api.openai.com/v1"
              />
              <Field
                label="New API key"
                name="apiKey"
                type="password"
                description="When left empty, the stored key is kept."
              />
              <Field
                label="Transcription model"
                name="transcriptionModel"
                value={settings.data?.transcriptionModel}
              />
              <Field
                label="Speech model"
                name="speechModel"
                value={settings.data?.speechModel}
              />
              <Field
                label="Default voice"
                name="voice"
                value={settings.data?.voice}
              />
              <SelectField
                label="Call mode"
                name="mode"
                defaultValue={settings.data?.mode ?? "auto"}
                description="Automatic: the Realtime API on an OpenAI address; speech → Dot model → speech synthesis pipeline on any other proxy address."
                options={[
                  { value: "auto", label: "Automatic" },
                  { value: "pipeline", label: "Proxy pipeline (STT → model → TTS)" },
                  { value: "realtime", label: "OpenAI Realtime API" },
                ]}
              />
              <SelectField
                label="Transcription method"
                name="transcriptionMode"
                defaultValue={settings.data?.transcriptionMode ?? "auto"}
                description="If a chat model that accepts audio input (e.g. Gemini) is selected, use “Chat model”."
                options={[
                  { value: "auto", label: "Automatic" },
                  { value: "audio", label: "Ses API'si (/audio/transcriptions)" },
                  { value: "chat", label: "Chat model (audio input)" },
                ]}
              />
              <Field
                label="Speech language"
                name="language"
                value={settings.data?.language}
                placeholder="tr"
              />
            </FormGrid>
            <Check
              name="enabled"
              label="Voice services enabled"
              checked={settings.data?.enabled}
            />
            <Check
              name="followCodexVoice"
              label="Use the voice selected in Codex for calls"
              description="When on, replies are read with the voice setting in the Codex app; when off, the speech model above is used."
              checked={settings.data?.followCodexVoice}
            />
          </Form>
        )}
      </Section>
    </>
  );
}

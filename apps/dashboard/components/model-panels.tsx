"use client";
import { Alert, Button, Chip } from "@heroui/react";
import { useContext, useEffect, useRef, useState } from "react";
import type { Settings } from "@dots/contracts";
import {
  Action,
  Actions,
  ApiContext,
  Check,
  ControlledField,
  Disclose,
  Empty,
  Field,
  Form,
  FormGrid,
  Loading,
  Notice,
  Section,
  SelectField,
  str,
  Tags,
  time,
  useData,
} from "./ui";
import { PlusIcon, CloseIcon } from "./icons";

export type ModelInfo = {
  id: string;
  fast: boolean;
  efforts: string[];
  defaultEffort: string | null;
  contextWindow: number | null;
  manual?: boolean;
};
export type ProviderView = {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: "responses" | "chat";
  hasKey: boolean;
  builtin: boolean;
  models: ModelInfo[];
  modelsFetchedAt: string | null;
  lastError: string | null;
};
type TestResult = {
  models: { ok: boolean; count?: number; error?: string };
  responses?: { ok: boolean; ms?: number; error?: string };
  chat?: { ok: boolean; ms?: number; error?: string };
  suggestedFormat: "responses" | "chat" | null;
};
const LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const effortLabel: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Maximum",
  ultra: "Ultra",
};
const formatLabel = { responses: "Responses API", chat: "Chat Completions" } as const;
/** Fast mode is only offered for GPT model ids (same rule as on the server). */
const isGpt = (id: string) => /(^|[/_.:-])(gpt|chatgpt)[-_.\d]|(^|[/_.:-])o\d/i.test(id);

/**
 * Model, thinking level and (GPT only) Fast mode selection.
 * Produces fields named model / reasoningEffort / serviceTier in the form.
 * With inherit=true an empty choice means "use the higher-level default".
 */
export function ModelPicker({
  model,
  reasoningEffort,
  serviceTier,
  inherit = false,
  blankLabel = "Default model",
}: {
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  inherit?: boolean;
  blankLabel?: string;
}) {
  const catalog = useData<{ providerId: string; models: ModelInfo[] }>("models", 30000);
  const settings = useData<Settings>(inherit ? "settings" : null);
  const models = catalog.data?.models ?? [];
  const [selected, setSelected] = useState(model ?? "");
  const [customFlag, setCustomFlag] = useState(false);
  const [effort, setEffort] = useState(reasoningEffort ?? "");
  const [fast, setFast] = useState(serviceTier === "priority");
  const known = models.find((m) => m.id === selected);
  const custom = customFlag || (!!selected && !!catalog.data && !known);
  const effective = selected || (inherit ? (settings.data?.model ?? "") : "");
  const effectiveInfo = models.find((m) => m.id === effective);
  const efforts = effectiveInfo ? effectiveInfo.efforts : LADDER;
  const unsupported = !!effectiveInfo && effectiveInfo.efforts.length === 0;
  const fastAvailable = effectiveInfo ? effectiveInfo.fast : !!effective && isGpt(effective);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // When the model changes, do not keep a level the new model does not support.
    if (effort && effectiveInfo && !effectiveInfo.efforts.includes(effort))
      setEffort(effectiveInfo.defaultEffort ?? "");
    if (!fastAvailable) setFast(false);
  }, [selected, effectiveInfo, fastAvailable]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = effort && efforts.includes(effort) ? effort : "";
  const effortValue = unsupported
    ? inherit
      ? ""
      : "none"
    : valid ||
      (inherit
        ? ""
        : (effectiveInfo?.defaultEffort ??
          efforts[efforts.length > 2 ? 2 : 0] ??
          "high"));
  const effortOptions = [
    ...(inherit || !valid || unsupported
      ? [
          {
            value: "",
            label: inherit
              ? "Default"
              : effectiveInfo?.defaultEffort
                ? effortLabel[effectiveInfo.defaultEffort] + " (model default)"
                : "Model default",
          },
        ]
      : []),
    ...efforts.map((e) => ({ value: e, label: effortLabel[e] ?? e })),
  ];
  return (
    <>
      <div className="flex flex-col gap-2">
        <SelectField
          label="Model"
          value={custom ? "__custom" : selected}
          onChange={(value) => {
            setCustomFlag(value === "__custom");
            setSelected(value === "__custom" ? "" : value);
          }}
          description={
            catalog.loading && !catalog.data
              ? "Loading the model list…"
              : models.length
                ? models.length + " models · fetched from the active provider"
                : "The model list is empty. Fetch models in Settings → Model providers or type a custom name."
          }
          options={[
            { value: "", label: blankLabel },
            ...models.map((m) => ({ value: m.id, label: m.id })),
            { value: "__custom", label: "Type a custom model name…" },
          ]}
        />
        {custom && (
          <ControlledField
            label="Custom model name"
            value={selected}
            onChange={(value) => setSelected(value.trim())}
            placeholder="e.g. gpt-6.1-sol"
          />
        )}
        <input type="hidden" name="model" value={selected} />
      </div>
      <SelectField
        label="Thinking level"
        value={unsupported ? "" : valid}
        disabled={unsupported}
        onChange={setEffort}
        options={effortOptions}
        description={
          unsupported
            ? "This model does not support choosing a thinking level."
            : effectiveInfo
              ? "The options are the levels this model supports."
              : "The model is unknown; all levels are shown."
        }
      />
      <input type="hidden" name="reasoningEffort" value={effortValue} />
      {fastAvailable && (
        <Check
          label={
            inherit
              ? "Fast mode (the global setting applies when unselected)"
              : "Fast mode (priority service tier)"
          }
          isSelected={fast}
          onChange={setFast}
        />
      )}
      <input
        type="hidden"
        name="serviceTier"
        value={fastAvailable && fast ? "priority" : ""}
      />
    </>
  );
}

function TestReport({
  result,
  current,
  id,
}: {
  result: TestResult;
  current: string;
  id: string;
}) {
  const { mutate } = useContext(ApiContext);
  const line = (
    label: string,
    r?: { ok: boolean; ms?: number; error?: string },
  ) =>
    r && (
      <li>
        {label}:{" "}
        {r.ok
          ? "running" + (r.ms ? " (" + (r.ms / 1000).toFixed(1) + " s)" : "")
          : "not working" + (r.error ? " — " + r.error : "")}
      </li>
    );
  const ok = Boolean(result.suggestedFormat);
  return (
    <Alert status={ok ? "success" : "warning"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Connection test</Alert.Title>
        <Alert.Description>
          <ul className="list-disc ps-5">
            <li>
              Model list:{" "}
              {result.models.ok
                ? result.models.count + " models fetched"
                : "failed — " + result.models.error}
            </li>
            {line("Responses API", result.responses)}
            {line("Chat Completions", result.chat)}
          </ul>
          <div className="mt-2">
            {result.suggestedFormat && result.suggestedFormat !== current ? (
              <Button
                size="sm"
                onPress={() =>
                  mutate("providers/" + id, "PATCH", {
                    apiFormat: result.suggestedFormat,
                  })
                }
              >
                Format {formatLabel[result.suggestedFormat]} yap
              </Button>
            ) : result.suggestedFormat ? (
              <p>The selected API format is compatible with this provider.</p>
            ) : (
              <p>Neither format responded; check the address, key and model name.</p>
            )}
          </div>
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function ProviderCard({
  provider,
  active,
  settings,
}: {
  provider: ProviderView;
  active: boolean;
  settings?: Settings;
}) {
  const { mutate } = useContext(ApiContext);
  const [result, setResult] = useState<TestResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const manual = provider.models
    .filter((m) => m.manual)
    .map((m) => m.id)
    .join("\n");
  async function run(work: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Section
      title={provider.name}
      description={
        provider.baseUrl +
        (provider.modelsFetchedAt
          ? " · Models fetched " + time(provider.modelsFetchedAt) + " "
          : "")
      }
      action={
        active ? (
          <Chip size="sm" variant="soft" color="success">
            Active
          </Chip>
        ) : undefined
      }
    >
      <Tags
        items={[
          formatLabel[provider.apiFormat],
          provider.builtin
            ? "Key in the server environment"
            : provider.hasKey
              ? "Key stored encrypted"
              : "No key",
          provider.models.length + " models",
        ]}
      />
      {provider.lastError && (
        <p className="text-sm text-danger" role="alert">
          Last model fetch error: {provider.lastError}
        </p>
      )}
      <Notice error={error} />
      <Actions>
        {!active && (
          <Button
            size="sm"
            isPending={pending}
            onPress={() =>
              run(async () => {
                const keep =
                  settings?.model &&
                  provider.models.some((m) => m.id === settings.model);
                await mutate("settings", "PATCH", {
                  activeProviderId: provider.id,
                  model: keep ? settings?.model : (provider.models[0]?.id ?? null),
                });
              })
            }
          >
            Use this
          </Button>
        )}
        <Action path={"providers/" + provider.id + "/refresh-models"}>
          Fetch models
        </Action>
        <Button
          size="sm"
          variant="secondary"
          isPending={pending}
          onPress={() =>
            run(async () =>
              setResult(
                (await mutate(
                  "providers/" + provider.id + "/test",
                  "POST",
                  {},
                )) as TestResult,
              ),
            )
          }
        >
          Test connection
        </Button>
      </Actions>
      {result && (
        <TestReport result={result} current={provider.apiFormat} id={provider.id} />
      )}
      {provider.models.length > 0 && (
        <Disclose summary={`Models (${provider.models.length})`}>
          <div className="flex flex-wrap gap-2">
            {provider.models.map((m) => (
              <Chip
                key={m.id}
                size="sm"
                variant="soft"
                title={
                  m.efforts.length
                    ? "Thinking: " + m.efforts.join(", ")
                    : "No thinking level"
                }
              >
                {m.id}
                {m.fast ? " · fast" : ""}
              </Chip>
            ))}
          </div>
        </Disclose>
      )}
      {!provider.builtin && (
        <>
          <Disclose summary="Edit">
            <Form
              key={JSON.stringify([
                provider.name,
                provider.baseUrl,
                provider.apiFormat,
                provider.hasKey,
                manual,
              ])}
              onSubmit={(d) =>
                mutate("providers/" + provider.id, "PATCH", {
                  name: str(d, "name"),
                  baseUrl: str(d, "baseUrl"),
                  apiFormat: str(d, "apiFormat"),
                  manualModels: str(d, "manualModels")
                    .split(/[\r\n,]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  ...(d.has("clearKey")
                    ? { apiKey: null }
                    : str(d, "apiKey")
                      ? { apiKey: str(d, "apiKey") }
                      : {}),
                })
              }
            >
              <ProviderFields provider={provider} manual={manual} editing />
            </Form>
          </Disclose>
          <Disclose summary="Delete provider">
            <p className="text-sm text-muted">
              The stored key is deleted too. If this provider is active, the server default is used again.
            </p>
            <Action path={"providers/" + provider.id} method="DELETE" variant="danger">
              Delete provider
            </Action>
          </Disclose>
        </>
      )}
    </Section>
  );
}

function ProviderFields({
  provider,
  manual = "",
  editing = false,
}: {
  provider?: ProviderView;
  manual?: string;
  editing?: boolean;
}) {
  return (
    <>
      <FormGrid>
        <Field
          label="Name"
          name="name"
          value={provider?.name}
          required
          placeholder="e.g. OpenRouter"
        />
        <Field
          label="API address"
          name="baseUrl"
          value={provider?.baseUrl}
          required
          placeholder="https://api.openai.com/v1"
          description="Remote providers require HTTPS; local addresses may use HTTP. /v1 is tried automatically if missing."
        />
        <Field
          label={editing ? "New API key" : "API key"}
          name="apiKey"
          type="password"
          placeholder={
            editing
              ? provider?.hasKey
                ? "Leave empty to keep the stored key"
                : "No key"
              : "sk-…  (may be empty)"
          }
          description="The key is stored encrypted; it cannot be viewed later and is never written to logs."
        />
        <SelectField
          label="API format"
          name="apiFormat"
          defaultValue={provider?.apiFormat ?? "responses"}
          description="If you are not sure, save the provider and use “Test connection” to see which one works."
          options={[
            { value: "responses", label: "Responses API (/responses)" },
            { value: "chat", label: "Chat Completions (/chat/completions)" },
          ]}
        />
      </FormGrid>
      <Field
        label="Models added manually"
        name="manualModels"
        type="textarea"
        value={manual}
        placeholder="One model name per line (if the list cannot be fetched)"
      />
      {editing && provider?.hasKey && (
        <Check name="clearKey" label="Delete the stored key" />
      )}
    </>
  );
}

export function ProvidersPanel() {
  const providers = useData<{ items: ProviderView[]; activeProviderId: string }>(
    "providers", 30000,
  );
  const settings = useData<Settings>("settings");
  const { mutate } = useContext(ApiContext);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Section
        title="Model providers"
        description="Add your own API address and key; the model list refreshes automatically every 30 seconds. Both Responses and Chat Completions providers work."
        action={
          <Button onPress={() => setAdding(!adding)}>
            {adding ? <CloseIcon /> : <PlusIcon />}
            {adding ? "Close" : "Add provider"}
          </Button>
        }
      >
        <Notice error={providers.error} />
        {adding && (
          <Form
            submit="Save provider"
            onDone={() => setAdding(false)}
            onSubmit={(d) =>
              mutate("providers", "POST", {
                name: str(d, "name"),
                baseUrl: str(d, "baseUrl"),
                apiFormat: str(d, "apiFormat"),
                ...(str(d, "apiKey") ? { apiKey: str(d, "apiKey") } : {}),
                manualModels: str(d, "manualModels")
                  .split(/[\r\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          >
            <ProviderFields />
          </Form>
        )}
        {providers.loading && !providers.data ? (
          <Loading />
        ) : !providers.data?.items.length ? (
          <Empty>Provider not found.</Empty>
        ) : null}
      </Section>
      {providers.data?.items.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          active={p.id === providers.data?.activeProviderId}
          settings={settings.data}
        />
      ))}
    </>
  );
}

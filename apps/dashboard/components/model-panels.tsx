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
  none: "Kapalı",
  minimal: "Minimal",
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  xhigh: "Çok yüksek",
  max: "Maksimum",
  ultra: "Ultra",
};
const formatLabel = { responses: "Responses API", chat: "Chat Completions" } as const;
/** Hızlı mod yalnızca GPT model kimliklerinde sunulur (sunucudaki kuralla aynı). */
const isGpt = (id: string) => /(^|[/_.:-])(gpt|chatgpt)[-_.\d]|(^|[/_.:-])o\d/i.test(id);

/**
 * Model, düşünme düzeyi ve (yalnızca GPT için) Hızlı mod seçimi.
 * Formda model / reasoningEffort / serviceTier adlı alanlar üretir.
 * inherit=true iken boş seçim "üst düzeydeki varsayılanı kullan" anlamına gelir.
 */
export function ModelPicker({
  model,
  reasoningEffort,
  serviceTier,
  inherit = false,
  blankLabel = "Varsayılan model",
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
    // Model değişince, yeni modelin desteklemediği düzey seçili kalmasın.
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
              ? "Varsayılan"
              : effectiveInfo?.defaultEffort
                ? effortLabel[effectiveInfo.defaultEffort] + " (model varsayılanı)"
                : "Model varsayılanı",
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
              ? "Model listesi alınıyor…"
              : models.length
                ? models.length + " model · etkin sağlayıcıdan çekildi"
                : "Model listesi boş. Ayarlar’daki Model sağlayıcıları bölümünden modelleri çekin veya özel ad yazın."
          }
          options={[
            { value: "", label: blankLabel },
            ...models.map((m) => ({ value: m.id, label: m.id })),
            { value: "__custom", label: "Özel model adı yaz…" },
          ]}
        />
        {custom && (
          <ControlledField
            label="Özel model adı"
            value={selected}
            onChange={(value) => setSelected(value.trim())}
            placeholder="örn. gpt-6.1-sol"
          />
        )}
        <input type="hidden" name="model" value={selected} />
      </div>
      <SelectField
        label="Düşünme düzeyi"
        value={unsupported ? "" : valid}
        disabled={unsupported}
        onChange={setEffort}
        options={effortOptions}
        description={
          unsupported
            ? "Bu model düşünme düzeyi seçimini desteklemiyor."
            : effectiveInfo
              ? "Seçenekler bu modelin desteklediği düzeylerdir."
              : "Model bilinmiyor; tüm düzeyler gösteriliyor."
        }
      />
      <input type="hidden" name="reasoningEffort" value={effortValue} />
      {fastAvailable && (
        <Check
          label={
            inherit
              ? "Hızlı mod (seçili değilse genel ayar geçerli)"
              : "Hızlı mod (öncelikli servis katmanı)"
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
          ? "çalışıyor" + (r.ms ? " (" + (r.ms / 1000).toFixed(1) + " sn)" : "")
          : "çalışmıyor" + (r.error ? " — " + r.error : "")}
      </li>
    );
  const ok = Boolean(result.suggestedFormat);
  return (
    <Alert status={ok ? "success" : "warning"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Bağlantı denemesi</Alert.Title>
        <Alert.Description>
          <ul className="list-disc ps-5">
            <li>
              Model listesi:{" "}
              {result.models.ok
                ? result.models.count + " model alındı"
                : "alınamadı — " + result.models.error}
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
                Biçimi {formatLabel[result.suggestedFormat]} yap
              </Button>
            ) : result.suggestedFormat ? (
              <p>Seçili API biçimi bu sağlayıcıyla uyumlu.</p>
            ) : (
              <p>İki biçim de yanıt vermedi; adres, anahtar ve model adını kontrol et.</p>
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
      setError(e instanceof Error ? e.message : "İşlem başarısız.");
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
          ? " · Modeller " + time(provider.modelsFetchedAt) + " tarihinde çekildi"
          : "")
      }
      action={
        active ? (
          <Chip size="sm" variant="soft" color="success">
            Etkin
          </Chip>
        ) : undefined
      }
    >
      <Tags
        items={[
          formatLabel[provider.apiFormat],
          provider.builtin
            ? "Anahtar sunucu ortamında"
            : provider.hasKey
              ? "Anahtar şifreli kayıtlı"
              : "Anahtarsız",
          provider.models.length + " model",
        ]}
      />
      {provider.lastError && (
        <p className="text-sm text-danger" role="alert">
          Son model çekme hatası: {provider.lastError}
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
            Bunu kullan
          </Button>
        )}
        <Action path={"providers/" + provider.id + "/refresh-models"}>
          Modelleri çek
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
          Bağlantıyı dene
        </Button>
      </Actions>
      {result && (
        <TestReport result={result} current={provider.apiFormat} id={provider.id} />
      )}
      {provider.models.length > 0 && (
        <Disclose summary={`Modeller (${provider.models.length})`}>
          <div className="flex flex-wrap gap-2">
            {provider.models.map((m) => (
              <Chip
                key={m.id}
                size="sm"
                variant="soft"
                title={
                  m.efforts.length
                    ? "Düşünme: " + m.efforts.join(", ")
                    : "Düşünme düzeyi yok"
                }
              >
                {m.id}
                {m.fast ? " · hızlı" : ""}
              </Chip>
            ))}
          </div>
        </Disclose>
      )}
      {!provider.builtin && (
        <>
          <Disclose summary="Düzenle">
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
          <Disclose summary="Sağlayıcıyı sil">
            <p className="text-sm text-muted">
              Kayıtlı anahtar da silinir. Bu sağlayıcı etkinse sunucu varsayılanına
              dönülür.
            </p>
            <Action path={"providers/" + provider.id} method="DELETE" variant="danger">
              Sağlayıcıyı sil
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
          label="Ad"
          name="name"
          value={provider?.name}
          required
          placeholder="örn. OpenRouter"
        />
        <Field
          label="API adresi"
          name="baseUrl"
          value={provider?.baseUrl}
          required
          placeholder="https://api.openai.com/v1"
          description="Uzak sağlayıcılar HTTPS gerektirir; yerel adresler HTTP olabilir. /v1 eksikse otomatik denenir."
        />
        <Field
          label={editing ? "Yeni API anahtarı" : "API anahtarı"}
          name="apiKey"
          type="password"
          placeholder={
            editing
              ? provider?.hasKey
                ? "Kayıtlı anahtarı korumak için boş bırak"
                : "Anahtar yok"
              : "sk-…  (boş olabilir)"
          }
          description="Anahtar şifrelenerek saklanır; sonradan görüntülenemez ve günlüklere yazılmaz."
        />
        <SelectField
          label="API biçimi"
          name="apiFormat"
          defaultValue={provider?.apiFormat ?? "responses"}
          description="Emin değilsen sağlayıcıyı kaydet ve “Bağlantıyı dene” ile hangisinin çalıştığına bak."
          options={[
            { value: "responses", label: "Responses API (/responses)" },
            { value: "chat", label: "Chat Completions (/chat/completions)" },
          ]}
        />
      </FormGrid>
      <Field
        label="Elle eklenen modeller"
        name="manualModels"
        type="textarea"
        value={manual}
        placeholder="Satır başına bir model adı (liste çekilemiyorsa)"
      />
      {editing && provider?.hasKey && (
        <Check name="clearKey" label="Kayıtlı anahtarı sil" />
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
        title="Model sağlayıcıları"
        description="Kendi API adresini ve anahtarını ekle; model listesi 30 saniyede bir otomatik yenilenir. Hem Responses hem Chat Completions sağlayıcıları çalışır."
        action={
          <Button onPress={() => setAdding(!adding)}>
            {adding ? <CloseIcon /> : <PlusIcon />}
            {adding ? "Kapat" : "Sağlayıcı ekle"}
          </Button>
        }
      >
        <Notice error={providers.error} />
        {adding && (
          <Form
            submit="Sağlayıcıyı kaydet"
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
          <Empty>Sağlayıcı bulunamadı.</Empty>
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

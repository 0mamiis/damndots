"use client";
import { Button, Card } from "@heroui/react";
import { useContext, useState } from "react";
import type {
  ApiList,
  Approval,
  Computer,
  Dot,
  Memory,
  Output,
  Schedule,
} from "@dots/contracts";
import {
  Action,
  Actions,
  ApiContext,
  Check,
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
  newest,
} from "./ui";
import { ComputerSelect, DotSelect } from "./runtime-panels";
import { CloseIcon, FileIcon, PlusIcon } from "./icons";
type InputQuestion = {
  id: string;
  header?: string;
  question: string;
  options?: { label: string; description?: string }[];
};
type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
};
function ApprovalDecision({ approval }: { approval: Approval }) {
  const { mutate } = useContext(ApiContext);
  const questions = Array.isArray(approval.request.questions)
    ? (approval.request.questions as InputQuestion[])
    : [];
  const schema = approval.request.requestedSchema as
    | { properties?: Record<string, SchemaProperty>; required?: string[] }
    | undefined;
  if (questions.length)
    return (
      <div className="flex flex-col gap-3">
        <Form
          submit="Yanıtları gönder"
          onSubmit={(data) => {
            const answers: Record<string, { answers: string[] }> = {};
            for (const question of questions) {
              const free = str(data, `free-${question.id}`).trim();
              const chosen = str(data, `choice-${question.id}`).trim();
              if (!free && !chosen)
                throw new Error(
                  `${question.header ?? question.question}: bir yanıt gerekli.`,
                );
              answers[question.id] = { answers: [free || chosen] };
            }
            return mutate(`approvals/${approval.id}/resolve`, "POST", {
              approved: true,
              resolution: { answers },
            });
          }}
        >
          {questions.map((question) => (
            <div key={question.id} className="flex flex-col gap-3">
              <div>
                <h3 className="font-semibold">
                  {question.header ?? question.question}
                </h3>
                {question.header && (
                  <p className="text-sm text-muted">{question.question}</p>
                )}
              </div>
              {(question.options?.length ?? 0) > 0 && (
                <SelectField
                  label="Seçenek"
                  name={`choice-${question.id}`}
                  defaultValue=""
                  options={[
                    { value: "", label: "Yanıt seçin veya aşağıya yazın" },
                    ...(question.options ?? []).map((option) => ({
                      value: option.label,
                      label: option.description
                        ? `${option.label} — ${option.description}`
                        : option.label,
                    })),
                  ]}
                />
              )}
              <Field
                label={question.options?.length ? "Kendi yanıtın" : "Yanıtın"}
                name={`free-${question.id}`}
                type="textarea"
                required={!question.options?.length}
              />
            </div>
          ))}
        </Form>
        <div>
          <Action
            path={`approvals/${approval.id}/resolve`}
            body={{ approved: false }}
            variant="danger"
          >
            Yanıtlamayı reddet
          </Action>
        </div>
      </div>
    );
  if (schema?.properties) {
    const properties = Object.entries(schema.properties);
    const simple = properties.every(
      ([, p]) =>
        !p.type || ["string", "number", "integer", "boolean"].includes(p.type),
    );
    return (
      <div className="flex flex-col gap-3">
        <Form
          submit="Bilgileri gönder"
          onSubmit={(data) => {
            let content: Record<string, unknown>;
            if (simple) {
              content = {};
              for (const [name, property] of properties) {
                const value = str(data, name);
                if (property.type === "boolean") content[name] = data.has(name);
                else if (
                  property.type === "number" ||
                  property.type === "integer"
                ) {
                  if (value) content[name] = Number(value);
                } else if (value) content[name] = value;
                if (
                  property.type !== "boolean" &&
                  !value &&
                  schema.required?.includes(name)
                )
                  throw new Error(`${property.title ?? name} alanı gerekli.`);
              }
            } else {
              content = JSON.parse(str(data, "content"));
              if (
                !content ||
                typeof content !== "object" ||
                Array.isArray(content)
              )
                throw new Error("Bir JSON nesnesi gerekli.");
            }
            return mutate(`approvals/${approval.id}/resolve`, "POST", {
              approved: true,
              resolution: { content },
            });
          }}
        >
          {simple ? (
            properties.map(([name, property]) =>
              property.type === "boolean" ? (
                <Check
                  key={name}
                  name={name}
                  label={property.title ?? name}
                  checked={Boolean(property.default)}
                />
              ) : property.enum ? (
                <SelectField
                  key={name}
                  label={property.title ?? name}
                  name={name}
                  description={property.description}
                  required={schema.required?.includes(name)}
                  defaultValue={
                    typeof property.default === "string" ? property.default : ""
                  }
                  options={[
                    { value: "", label: "Seçin" },
                    ...property.enum.map((value) => ({ value, label: value })),
                  ]}
                />
              ) : (
                <Field
                  key={name}
                  name={name}
                  label={property.title ?? name}
                  description={property.description}
                  type={
                    ["number", "integer"].includes(property.type ?? "")
                      ? "number"
                      : "text"
                  }
                  value={
                    typeof property.default === "boolean"
                      ? undefined
                      : property.default
                  }
                  required={schema.required?.includes(name)}
                />
              ),
            )
          ) : (
            <>
              <Json value={schema} />
              <Field
                label="Yanıt içeriği (JSON)"
                name="content"
                type="textarea"
                value="{}"
                required
              />
            </>
          )}
        </Form>
        <div>
          <Action
            path={`approvals/${approval.id}/resolve`}
            body={{ approved: false }}
            variant="danger"
          >
            Bilgi vermeyi reddet
          </Action>
        </div>
      </div>
    );
  }
  return (
    <Actions>
      <Action
        path={`approvals/${approval.id}/resolve`}
        body={{ approved: true }}
        variant="primary"
      >
        İşlemi onayla
      </Action>
      <Action
        path={`approvals/${approval.id}/resolve`}
        body={{ approved: false }}
        variant="danger"
      >
        Reddet
      </Action>
    </Actions>
  );
}
export function MemoryPanel() {
  const dots = useData<ApiList<Dot>>("dots");
  const memories = useData<ApiList<Memory>>("memories");
  const [edit, setEdit] = useState<Memory | null | undefined>();
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="Hatırlanacak şeyler"
        title="Hafıza"
        description="Dot’larının sonraki görevlerde kullanacağı bilgileri düzenle."
        action={
          <Button onPress={() => setEdit(null)}>
            <PlusIcon />
            Bilgi ekle
          </Button>
        }
      />
      <Notice error={memories.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Bilgiyi düzenle" : "Yeni bilgi"}
          action={
            <Button size="sm" variant="ghost" onPress={() => setEdit(undefined)}>
              <CloseIcon width={14} height={14} />
              Kapat
            </Button>
          }
        >
          <Form
            key={edit?.id ?? "new"}
            submit={edit ? "Değişiklikleri kaydet" : "Hafızaya ekle"}
            onDone={() => setEdit(undefined)}
            onSubmit={(d) =>
              mutate(
                edit ? `memories/${edit.id}` : "memories",
                edit ? "PATCH" : "POST",
                {
                  dotId: str(d, "dotId"),
                  title: str(d, "title"),
                  content: str(d, "content"),
                  tags: str(d, "tags")
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                },
              )
            }
          >
            <FormGrid>
              <DotSelect
                dots={dots.data?.items ?? []}
                value={edit?.dotId}
                disabled={Boolean(edit)}
              />
              <Field label="Başlık" name="title" value={edit?.title} required />
              <Field
                label="Etiketler"
                name="tags"
                value={edit?.tags.join(", ")}
                description="Virgülle ayırın."
              />
            </FormGrid>
            <Field
              label="İçerik"
              name="content"
              type="textarea"
              value={edit?.content}
              required
            />
          </Form>
        </Section>
      )}
      {memories.loading && !memories.data ? (
        <Loading />
      ) : !memories.data?.items.length ? (
        <Empty>
          Henüz hafızaya eklenmiş bilgi yok. Dot’unun hatırlamasını istediğin bir
          bilgi ekle.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {memories.data.items.map((memory) => (
            <Card key={memory.id} className="gap-3">
              <Card.Header className="flex-row items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <Card.Title
                    className="text-base"
                    render={(props) => <h2 {...props} />}
                  >
                    {memory.title}
                  </Card.Title>
                  <Card.Description>
                    {dots.data?.items.find((d) => d.id === memory.dotId)?.name ??
                      memory.dotId}{" "}
                    · {time(memory.updatedAt)}
                  </Card.Description>
                </div>
                <Actions>
                  <Button size="sm" variant="ghost" onPress={() => setEdit(memory)}>
                    Düzenle
                  </Button>
                  <Action
                    path={`memories/${memory.id}`}
                    method="DELETE"
                    variant="ghost"
                  >
                    Sil
                  </Action>
                </Actions>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                <p className="preserve text-sm">{memory.content}</p>
                {memory.tags.length > 0 && <Tags items={memory.tags} />}
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
function parseOnce(value: string) {
  const date = new Date(value);
  if (!value.trim() || Number.isNaN(date.getTime()))
    throw new Error(
      "Çalışma zamanı geçerli bir tarih olmalı. Örn. 2026-10-01T09:00:00+03:00",
    );
  return date.toISOString();
}
export function SchedulePanel() {
  const dots = useData<ApiList<Dot>>("dots");
  const computers = useData<ApiList<Computer>>("computers");
  const schedules = useData<ApiList<Schedule>>("schedules");
  const [edit, setEdit] = useState<Schedule | null | undefined>();
  const [kind, setKind] = useState("interval");
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="Zamanı geldiğinde"
        title="Zamanlama"
        description="Tek seferlik veya tekrarlayan işler; seçtiğin saat diliminde."
        action={
          <Button
            onPress={() => {
              setEdit(null);
              setKind("interval");
            }}
          >
            <PlusIcon />
            Zamanlama oluştur
          </Button>
        }
      />
      <Notice error={schedules.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Zamanlamayı düzenle" : "Yeni zamanlama"}
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
            onSubmit={(d) =>
              mutate(
                edit ? `schedules/${edit.id}` : "schedules",
                edit ? "PATCH" : "POST",
                {
                  dotId: str(d, "dotId"),
                  title: str(d, "title"),
                  prompt: str(d, "prompt"),
                  kind: str(d, "kind"),
                  timezone: str(d, "timezone"),
                  intervalSeconds:
                    kind === "interval" ? Number(str(d, "intervalSeconds")) : null,
                  cron: kind === "cron" ? str(d, "cron") : null,
                  rrule: kind === "rrule" ? str(d, "rrule") : undefined,
                  nextRunAt:
                    kind === "once" ? parseOnce(str(d, "nextRunAt")) : undefined,
                  computerId: nullable(d, "computerId"),
                  enabled: d.has("enabled"),
                  proactive: d.has("proactive"),
                },
              )
            }
          >
            <FormGrid>
              <DotSelect
                dots={dots.data?.items ?? []}
                value={edit?.dotId}
                disabled={Boolean(edit)}
              />
              <Field label="Başlık" name="title" required value={edit?.title} />
              <SelectField
                label="Zamanlama türü"
                name="kind"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "interval", label: "Aralıklarla" },
                  { value: "once", label: "Tek sefer" },
                  { value: "cron", label: "Cron ifadesi" },
                  { value: "rrule", label: "Takvim kuralı (RRULE)" },
                ]}
              />
              <Field
                label="Saat dilimi"
                name="timezone"
                value={edit?.timezone ?? "Europe/Istanbul"}
                required
              />
              {kind === "interval" && (
                <Field
                  label="Tekrar aralığı (saniye)"
                  name="intervalSeconds"
                  type="number"
                  value={edit?.intervalSeconds ?? 3600}
                  required
                />
              )}
              {kind === "cron" && (
                <Field
                  label="Cron ifadesi"
                  name="cron"
                  value={edit?.cron ?? "0 9 * * *"}
                  required
                  description="Dakika saat gün ay haftanın-günü"
                />
              )}
              {kind === "rrule" && (
                <Field
                  label="Takvim kuralı (RRULE)"
                  name="rrule"
                  type="textarea"
                  value={
                    edit?.rrule ?? "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"
                  }
                  required
                  description="iCalendar RRULE ifadesi. Saat dilimi ayrı alandan uygulanır."
                />
              )}
              {kind === "once" && (
                <Field
                  label="Çalışma zamanı (ISO 8601)"
                  name="nextRunAt"
                  value={edit?.nextRunAt ?? ""}
                  required
                  placeholder="2026-10-01T09:00:00+03:00"
                  description="Saat dilimi farkını da ekleyin."
                />
              )}
              <ComputerSelect
                computers={computers.data?.items ?? []}
                value={edit?.computerId}
              />
            </FormGrid>
            <Field
              label="Görev talimatı"
              name="prompt"
              type="textarea"
              required
              value={edit?.prompt}
            />
            <Check
              name="enabled"
              label="Zamanlama etkin"
              checked={edit?.enabled ?? true}
            />
            <Check
              name="proactive"
              label="Proaktif çalışma olarak işaretle"
              checked={edit?.proactive}
            />
          </Form>
        </Section>
      )}
      {schedules.loading && !schedules.data ? (
        <Loading />
      ) : !schedules.data?.items.length ? (
        <Empty>
          Zamanlama yok. Düzenli takip veya tek seferlik bir iş oluştur.
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {schedules.data.items.map((schedule) => (
            <Card key={schedule.id}>
              <Card.Content className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 className="text-base font-semibold">{schedule.title}</h2>
                  <p className="preserve text-sm">{schedule.prompt}</p>
                  <small className="text-muted">
                    {dots.data?.items.find((d) => d.id === schedule.dotId)?.name}{" "}
                    · {schedule.timezone} ·{" "}
                    {schedule.kind === "cron"
                      ? schedule.cron
                      : schedule.kind === "rrule"
                        ? (schedule.rrule ?? "Takvim kuralı")
                        : schedule.kind === "interval"
                          ? `${schedule.intervalSeconds} sn aralık`
                          : "Tek sefer"}
                  </small>
                  <small className="text-muted">
                    Sonraki: {time(schedule.nextRunAt)} · Son çalışma:{" "}
                    {time(schedule.lastRunAt)}
                  </small>
                </div>
                <Actions>
                  <Status value={schedule.enabled ? "enabled" : "paused"} />
                  <Action
                    path={`schedules/${schedule.id}`}
                    method="PATCH"
                    body={{ enabled: !schedule.enabled }}
                  >
                    {schedule.enabled ? "Duraklat" : "Etkinleştir"}
                  </Action>
                  <Action path={`schedules/${schedule.id}/run`}>
                    Şimdi çalıştır
                  </Action>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setEdit(schedule);
                      setKind(schedule.kind);
                    }}
                  >
                    Düzenle
                  </Button>
                  <Action
                    path={`schedules/${schedule.id}`}
                    method="DELETE"
                    variant="ghost"
                  >
                    Sil
                  </Action>
                </Actions>
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
export function OutputsPanel() {
  const dots = useData<ApiList<Dot>>("dots");
  const [dotId, setDotId] = useState("");
  const outputs = useData<ApiList<Output>>(
    `outputs?dotId=${encodeURIComponent(dotId)}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="İşin sonucu"
        title="Çıktılar"
        description="Görevlerin ürettiği dosyalar; doğrudan sunucundan."
      />
      <div className="max-w-sm">
        <SelectField
          label="Dot"
          value={dotId}
          onChange={setDotId}
          options={[
            { value: "", label: "Tüm Dot’lar" },
            ...(dots.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </div>
      <Notice error={outputs.error} />
      {outputs.loading && !outputs.data ? (
        <Loading />
      ) : !outputs.data?.items.length ? (
        <Empty>
          Henüz çıktı yok. Dosya üreten görevlerin sonuçları burada görünecek.
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {newest(outputs.data.items).map((output) => (
            <Row key={output.id}>
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"
                >
                  <FileIcon />
                </span>
                <div className="flex min-w-0 flex-col">
                  <h2 className="truncate text-base font-semibold">{output.name}</h2>
                  <small className="text-muted">
                    {output.mimeType} · {Math.ceil(output.size / 1024)} KB ·{" "}
                    {time(output.createdAt)}
                  </small>
                  <small className="truncate text-muted">Görev: {output.taskId}</small>
                </div>
              </div>
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href={`/api/backend/outputs/${output.id}/content`}
                download
              >
                Dosyayı indir
              </a>
            </Row>
          ))}
        </div>
      )}
    </>
  );
}
export function ApprovalPanel() {
  const approvals = useData<ApiList<Approval>>("approvals");
  return (
    <>
      <PageHeading
        eyebrow="Son söz sende"
        title="Onaylar"
        description="Dot’unun kararını beklediği işlemleri incele."
      />
      <Notice error={approvals.error} />
      {approvals.loading && !approvals.data ? (
        <Loading />
      ) : !approvals.data?.items.length ? (
        <Empty>Onay bekleyen veya kayıtlı bir işlem yok.</Empty>
      ) : (
        newest(approvals.data.items).map((approval) => (
          <Section
            key={approval.id}
            title={approval.title}
            description={`${approval.kind} · ${time(approval.createdAt)}`}
            action={<Status value={approval.status} />}
          >
            <p className="preserve text-sm">{approval.detail}</p>
            <Disclose summary="İşlem ayrıntıları">
              <Json value={approval.request} />
            </Disclose>
            {approval.status === "pending" && (
              <ApprovalDecision approval={approval} />
            )}
            {approval.resolution && (
              <Disclose summary="Gönderilen yanıt">
                <Json value={approval.resolution} />
              </Disclose>
            )}
          </Section>
        ))
      )}
    </>
  );
}

"use client";
import { Button, Chip, Tabs, Card } from "@heroui/react";
import { useContext, useEffect, useRef, useState } from "react";
import type {
  ApiList,
  Attachment,
  Computer,
  Dot,
  Message,
  Task,
  Activity,
  Output,
} from "@dots/contracts";
import { ModelPicker } from "./model-panels";
import {
  Action,
  Actions,
  ApiContext,
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
  Section,
  SelectField,
  Status,
  str,
  nullable,
  time,
  useData,
  newest,
  oldest,
} from "./ui";
import { CloseIcon, PaperclipIcon, PlusIcon } from "./icons";

export function DotSelect({
  dots,
  value,
  name = "dotId",
  disabled = false,
}: {
  dots: Dot[];
  value?: string;
  name?: string;
  disabled?: boolean;
}) {
  return (
    <SelectField
      label="Dot"
      name={name}
      required
      disabled={disabled}
      defaultValue={value ?? dots[0]?.id}
      placeholder="Dot seçin"
      options={dots.map((dot) => ({ value: dot.id, label: dot.name }))}
    />
  );
}
export function ComputerSelect({
  computers,
  value,
}: {
  computers: Computer[];
  value?: string | null;
}) {
  return (
    <SelectField
      label="Bilgisayar"
      name="computerId"
      defaultValue={value ?? ""}
      options={[
        { value: "", label: "Sunucunun varsayılan çalışma ortamı" },
        ...computers.map((c) => ({
          value: c.id,
          label: `${c.name} · ${c.state === "online" ? "çevrimiçi" : "çevrimdışı"}`,
        })),
      ]}
    />
  );
}
export function DotPanel() {
  const { data, error, loading } = useData<ApiList<Dot>>("dots");
  const computers = useData<ApiList<Computer>>("computers");
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const { mutate } = useContext(ApiContext);
  const current = data?.items.find((d) => d.id === selected) ?? data?.items[0];
  return (
    <>
      <PageHeading
        eyebrow="Kalıcı yardımcıların"
        title="Dot’lar"
        description="Her Dot’un kendi sohbeti, hafızası ve çalışma biçimi var."
        action={
          <Button onPress={() => setCreating(!creating)}>
            {creating ? <CloseIcon /> : <PlusIcon />}
            {creating ? "Kapat" : "Dot oluştur"}
          </Button>
        }
      />
      <Notice error={error} />
      {creating && (
        <Section title="Yeni Dot">
          <Form
            submit="Dot oluştur"
            onDone={() => setCreating(false)}
            onSubmit={(d) =>
              mutate("dots", "POST", {
                name: str(d, "name"),
                model: nullable(d, "model"),
                reasoningEffort: nullable(d, "reasoningEffort"),
                serviceTier: nullable(d, "serviceTier"),
                instructions: str(d, "instructions"),
                computerId: nullable(d, "computerId"),
              })
            }
          >
            <FormGrid>
              <Field label="Ad" name="name" required />
              <ComputerSelect computers={computers.data?.items ?? []} />
            </FormGrid>
            <FormGrid>
              <ModelPicker inherit blankLabel="Sunucunun varsayılan modeli" />
            </FormGrid>
            <Field
              label="Çalışma talimatları"
              name="instructions"
              type="textarea"
              placeholder="Dot’un neye odaklanmasını istersin?"
            />
          </Form>
        </Section>
      )}
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>Henüz Dot yok. İlk Dot’unu oluşturarak başla.</Empty>
      ) : (
        <>
          <Tabs
            selectedKey={current?.id}
            onSelectionChange={(key) => setSelected(String(key))}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Dot’lar">
                {data.items.map((dot) => (
                  <Tabs.Tab key={dot.id} id={dot.id}>
                    {dot.name}
                    {dot.paused ? " · duraklatıldı" : ""}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {data.items.map((dot) => (
              <Tabs.Panel key={dot.id} id={dot.id} className="pt-4">
                {current?.id === dot.id && (
                  <DotDetail
                    dot={dot}
                    computers={computers.data?.items ?? []}
                  />
                )}
              </Tabs.Panel>
            ))}
          </Tabs>
        </>
      )}
    </>
  );
}
function DotDetail({ dot, computers }: { dot: Dot; computers: Computer[] }) {
  const messages = useData<ApiList<Message>>(`dots/${dot.id}/messages`);
  const { mutate } = useContext(ApiContext);
  const [profile, setProfile] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [speakingId, setSpeakingId] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = messages.data?.items.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <Section
      title={dot.name}
      description={
        dot.paused
          ? "Dot duraklatıldı; mesajlar sırada korunur."
          : "Bir mesaj gönder; Dot onu görev olarak çalıştırsın."
      }
      action={
        <Actions>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setProfile(!profile)}
          >
            Profili düzenle
          </Button>
          <Action path={`dots/${dot.id}/${dot.paused ? "resume" : "pause"}`}>
            {dot.paused ? "Devam ettir" : "Duraklat"}
          </Action>
        </Actions>
      }
    >
      {profile && (
        <Form
          onSubmit={(d) =>
            mutate(`dots/${dot.id}`, "PATCH", {
              name: str(d, "name"),
              model: nullable(d, "model"),
              instructions: str(d, "instructions"),
              computerId: nullable(d, "computerId"),
              reasoningEffort: nullable(d, "reasoningEffort"),
              serviceTier: nullable(d, "serviceTier"),
              avatarUrl: nullable(d, "avatarUrl"),
              avatarManifest: str(d, "avatarManifest").trim()
                ? JSON.parse(str(d, "avatarManifest"))
                : null,
            })
          }
        >
          <FormGrid>
            <Field label="Ad" name="name" value={dot.name} required />
            <ComputerSelect computers={computers} value={dot.computerId} />
          </FormGrid>
          <FormGrid>
            <ModelPicker
              inherit
              model={dot.model}
              reasoningEffort={dot.reasoningEffort}
              serviceTier={dot.serviceTier}
            />
          </FormGrid>
          <Field
            label="Talimatlar"
            name="instructions"
            type="textarea"
            value={dot.instructions}
          />
          <Disclose summary="Avatar ayarları">
            <FormGrid>
              <Field
                label="Avatar adresi"
                name="avatarUrl"
                value={dot.avatarUrl}
                placeholder="https://…"
              />
              <Field
                label="Avatar manifesti (JSON)"
                name="avatarManifest"
                type="textarea"
                value={
                  dot.avatarManifest
                    ? JSON.stringify(dot.avatarManifest, null, 2)
                    : ""
                }
                description="Mevcut animasyon manifestini girin veya boş bırakın."
              />
            </FormGrid>
          </Disclose>
          <Disclose summary="Dot’u kaldır">
            <p className="text-sm text-muted">Bu işlem Dot profilini kaldırır.</p>
            <Action path={`dots/${dot.id}`} method="DELETE" variant="danger">
              Dot’u sil
            </Action>
          </Disclose>
        </Form>
      )}
      <Notice error={messages.error} />
      <div
        className="flex max-h-[28rem] min-h-40 flex-col gap-3 overflow-y-auto rounded-2xl bg-surface-secondary/50 p-4"
        role="log"
        aria-label="Sohbet"
        tabIndex={0}
      >
        {messages.loading && !messages.data ? (
          <Loading />
        ) : !messages.data?.items.length ? (
          <Empty>
            İlk mesajını gönder. Sonuçlar ve görevlerin durumu bu sohbette
            görünür.
          </Empty>
        ) : (
          oldest(messages.data.items).map((message) => {
            const mine = message.role === "user";
            return (
              <article
                key={message.id}
                className={`flex max-w-[85%] flex-col gap-1 rounded-2xl px-4 py-2.5 ${mine ? "self-end bg-accent/15" : "self-start border border-border bg-surface"}`}
              >
                <div className="flex items-center justify-between gap-4 text-xs text-muted">
                  <strong className="text-foreground">
                    {mine
                      ? "Sen"
                      : message.role === "assistant"
                        ? dot.name
                        : "Sistem"}
                  </strong>
                  <time>{time(message.createdAt)}</time>
                </div>
                <p className="preserve text-sm">{message.text}</p>
                {message.attachments.map((a) => (
                  <Chip key={a.id} size="sm" variant="soft">
                    {a.name}
                  </Chip>
                ))}
                {message.role === "assistant" && (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      isPending={speakingId === message.id}
                      onPress={async () => {
                        setSpeakingId(message.id);
                        setSpeechError("");
                        try {
                          const response = await fetch("/api/backend/voice/speak", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ text: message.text }),
                          });
                          if (!response.ok) {
                            const body = await response.json();
                            throw new Error(body.error ?? "Ses oluşturulamadı.");
                          }
                          const url = URL.createObjectURL(await response.blob());
                          const audio = new Audio(url);
                          audio.onended = () => URL.revokeObjectURL(url);
                          await audio.play();
                        } catch (error) {
                          setSpeechError(
                            error instanceof Error
                              ? error.message
                              : "Ses oluşturulamadı.",
                          );
                        } finally {
                          setSpeakingId("");
                        }
                      }}
                    >
                      Sesli dinle
                    </Button>
                  </div>
                )}
              </article>
            );
          })
        )}
        <div ref={end} />
      </div>
      <Notice error={speechError} />
      <Form
        key={`compose-${dot.id}`}
        submit="Mesaj gönder"
        disabled={uploading}
        onDone={() => setAttachments([])}
        onSubmit={async (d) => {
          if (uploading)
            throw new Error("Dosya yüklemesi tamamlandıktan sonra mesaj gönderin.");
          await mutate(`dots/${dot.id}/messages`, "POST", {
            text: str(d, "text"),
            attachments,
            requestId: crypto.randomUUID(),
            channel: "dashboard",
          });
          setText("");
        }}
      >
        <div
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.closest("form")?.requestSubmit();
            }
          }}
        >
          <ControlledField
            label="Mesajın"
            name="text"
            rows={3}
            required
            value={text}
            onChange={setText}
            placeholder="Dot’una bir görev ver veya birlikte düşün… (Ctrl+Enter ile gönder)"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            isPending={uploading}
            onPress={() => file.current?.click()}
          >
            <PaperclipIcon />
            {uploading ? "Dosya yükleniyor…" : "Dosya ekle"}
          </Button>
          <input
            ref={file}
            type="file"
            hidden
            tabIndex={-1}
            onChange={async (event) => {
              const picked = event.target.files?.[0];
              if (!picked) return;
              setUploading(true);
              setUploadError("");
              try {
                const form = new FormData();
                form.append("file", picked);
                const value = (await mutate(
                  `dots/${dot.id}/attachments`,
                  "POST",
                  form,
                )) as Attachment;
                setAttachments((current) => [...current, value]);
              } catch (e) {
                setUploadError(e instanceof Error ? e.message : "Yükleme başarısız.");
              } finally {
                setUploading(false);
                event.target.value = "";
              }
            }}
          />
          {attachments.map((a) => (
            <Chip key={a.id} size="sm" variant="soft">
              {a.name}
              <button
                type="button"
                className="ms-1 rounded-full p-0.5 hover:bg-default"
                aria-label={`${a.name} ekini kaldır`}
                onClick={() =>
                  setAttachments((items) => items.filter((x) => x.id !== a.id))
                }
              >
                <CloseIcon width={12} height={12} />
              </button>
            </Chip>
          ))}
        </div>
        <Notice error={uploadError} />
      </Form>
    </Section>
  );
}
const taskStatuses: Record<string, string> = {
  queued: "Sırada",
  running: "Çalışıyor",
  waiting_approval: "Onay bekliyor",
  paused: "Duraklatıldı",
  completed: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal edildi",
  interrupted: "Kesildi",
};
export function TaskPanel() {
  const dots = useData<ApiList<Dot>>("dots");
  const computers = useData<ApiList<Computer>>("computers");
  const [filter, setFilter] = useState("");
  const [dotFilter, setDotFilter] = useState("");
  const tasks = useData<ApiList<Task>>(
    `tasks?status=${encodeURIComponent(filter)}&dotId=${encodeURIComponent(dotFilter)}`,
  );
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const { mutate } = useContext(ApiContext);
  return (
    <>
      <PageHeading
        eyebrow="İşin akışı"
        title="Görevler"
        description="Sıraya al, durumu izle ve gerektiğinde yönünü değiştir."
        action={
          <Button onPress={() => setCreating(!creating)}>
            {creating ? <CloseIcon /> : <PlusIcon />}
            {creating ? "Kapat" : "Görev oluştur"}
          </Button>
        }
      />
      {creating && (
        <Section title="Yeni görev">
          <Form
            submit="Görevi sıraya al"
            onDone={() => setCreating(false)}
            onSubmit={(d) =>
              mutate("tasks", "POST", {
                dotId: str(d, "dotId"),
                title: str(d, "title"),
                input: str(d, "input"),
                computerId: nullable(d, "computerId"),
                ...(str(d, "model") ? { model: str(d, "model") } : {}),
                ...(str(d, "reasoningEffort")
                  ? { reasoningEffort: str(d, "reasoningEffort") }
                  : {}),
                ...(str(d, "serviceTier")
                  ? { serviceTier: str(d, "serviceTier") }
                  : {}),
                ...(str(d, "cwd") ? { cwd: str(d, "cwd") } : {}),
                source: "manual",
              })
            }
          >
            <FormGrid>
              <DotSelect dots={dots.data?.items ?? []} />
              <Field label="Başlık" name="title" />
              <ComputerSelect computers={computers.data?.items ?? []} />
            </FormGrid>
            <Field label="Görev" name="input" type="textarea" required />
            <Disclose summary="Bu görevin çalışma ayarları">
              <FormGrid>
                <ModelPicker inherit blankLabel="Dot’un varsayılan modeli" />
                <Field
                  label="Çalışma dizini"
                  name="cwd"
                  description="Bilgisayarın izin verilen çalışma köklerinden bir dizin."
                />
              </FormGrid>
            </Disclose>
          </Form>
        </Section>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Durum"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "", label: "Tüm durumlar" },
            ...Object.entries(taskStatuses).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <SelectField
          label="Dot"
          value={dotFilter}
          onChange={setDotFilter}
          options={[
            { value: "", label: "Tüm Dot’lar" },
            ...(dots.data?.items ?? []).map((dot) => ({
              value: dot.id,
              label: dot.name,
            })),
          ]}
        />
      </div>
      <Notice error={tasks.error} />
      {tasks.loading && !tasks.data ? (
        <Loading />
      ) : !tasks.data?.items.length ? (
        <Empty>Bu filtrelerde görev yok.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {newest(tasks.data.items).map((task) => (
            <Card key={task.id} className="gap-3">
              <Card.Content className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start px-2 py-1 text-left"
                    aria-expanded={selected === task.id}
                    onPress={() =>
                      setSelected(selected === task.id ? "" : task.id)
                    }
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <strong className="max-w-full truncate">{task.title}</strong>
                      <small className="max-w-full truncate font-normal text-muted">
                        {dots.data?.items.find((d) => d.id === task.dotId)?.name ??
                          task.dotId}{" "}
                        · {time(task.createdAt)} · {task.source}
                      </small>
                    </span>
                  </Button>
                  <Status value={task.status} />
                  <Actions>
                    {["queued", "running", "paused", "waiting_approval"].includes(
                      task.status,
                    ) && (
                      <Action path={`tasks/${task.id}/cancel`} variant="ghost">
                        İptal
                      </Action>
                    )}
                    {["failed", "cancelled", "interrupted"].includes(
                      task.status,
                    ) && (
                      <Action path={`tasks/${task.id}/retry`}>Yeniden dene</Action>
                    )}
                  </Actions>
                </div>
                {selected === task.id && (
                  <TaskDetail
                    task={task}
                    computers={computers.data?.items ?? []}
                  />
                )}
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}
function TaskDetail({
  task,
  computers,
}: {
  task: Task;
  computers: Computer[];
}) {
  const activity = useData<ApiList<Activity>>(`activity?taskId=${task.id}`);
  const outputs = useData<ApiList<Output>>(`outputs?taskId=${task.id}`);
  const { mutate } = useContext(ApiContext);
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Fact label="Görev kimliği">{task.id}</Fact>
        <Fact label="Üst görev">{task.parentTaskId ?? "Yok"}</Fact>
        <Fact label="Model / düşünme">
          {task.model ?? "Varsayılan"} / {task.reasoningEffort ?? "Varsayılan"}
        </Fact>
        <Fact label="Çalışma dizini">{task.cwd ?? "Varsayılan"}</Fact>
      </dl>
      <div>
        <h3 className="mb-1 font-semibold">Talimat</h3>
        <p className="preserve">{task.input}</p>
      </div>
      {task.result && (
        <div>
          <h3 className="mb-1 font-semibold">Sonuç</h3>
          <p className="preserve">{task.result}</p>
        </div>
      )}
      {task.error && <Notice error={task.error} />}
      <div>
        <h3 className="mb-1 font-semibold">Etkinlikler</h3>
        <Notice error={activity.error} />
        <ul className="flex flex-col gap-1 text-sm">
          {activity.data?.items.map((item) => (
            <li key={item.id}>
              {item.message}{" "}
              <small className="text-muted">{time(item.createdAt)}</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Çıktılar</h3>
        <Notice error={outputs.error} />
        <div className="flex flex-wrap gap-3">
          {outputs.data?.items.map((output) => (
            <a
              key={output.id}
              className="text-accent underline-offset-4 hover:underline"
              href={`/api/backend/outputs/${output.id}/content`}
              download
            >
              {output.name}
            </a>
          ))}
        </div>
      </div>
      <Disclose summary="Alt görev delege et">
        <Form
          submit="Alt görevi oluştur"
          onSubmit={(d) =>
            mutate(`tasks/${task.id}/delegate`, "POST", {
              title: str(d, "title"),
              input: str(d, "input"),
              computerId: nullable(d, "computerId"),
            })
          }
        >
          <Field label="Alt görev başlığı" name="title" required />
          <Field label="Alt görev talimatı" name="input" type="textarea" required />
          <ComputerSelect computers={computers} />
        </Form>
      </Disclose>
      <Disclose summary="Teknik ayrıntılar">
        <Json value={task} />
      </Disclose>
    </div>
  );
}

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
          submit="Send answers"
          onSubmit={(data) => {
            const answers: Record<string, { answers: string[] }> = {};
            for (const question of questions) {
              const free = str(data, `free-${question.id}`).trim();
              const chosen = str(data, `choice-${question.id}`).trim();
              if (!free && !chosen)
                throw new Error(
                  `${question.header ?? question.question}: an answer is required.`,
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
                  label="Option"
                  name={`choice-${question.id}`}
                  defaultValue=""
                  options={[
                    { value: "", label: "Choose an answer or type below" },
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
                label={question.options?.length ? "Your own answer" : "Your answer"}
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
            Decline to answer
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
          submit="Send details"
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
                  throw new Error(`${property.title ?? name} is required.`);
              }
            } else {
              content = JSON.parse(str(data, "content"));
              if (
                !content ||
                typeof content !== "object" ||
                Array.isArray(content)
              )
                throw new Error("A JSON object is required.");
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
                    { value: "", label: "Select" },
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
                label="Answer content (JSON)"
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
            Decline to provide details
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
        Approve the action
      </Action>
      <Action
        path={`approvals/${approval.id}/resolve`}
        body={{ approved: false }}
        variant="danger"
      >
        Deny
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
        eyebrow="Things to remember"
        title="Memory"
        description="Edit the information your Dots will use in later tasks."
        action={
          <Button onPress={() => setEdit(null)}>
            <PlusIcon />
            Add information
          </Button>
        }
      />
      <Notice error={memories.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Edit information" : "New information"}
          action={
            <Button size="sm" variant="ghost" onPress={() => setEdit(undefined)}>
              <CloseIcon width={14} height={14} />
              Close
            </Button>
          }
        >
          <Form
            key={edit?.id ?? "new"}
            submit={edit ? "Save changes" : "Add to memory"}
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
              <Field label="Title" name="title" value={edit?.title} required />
              <Field
                label="Tags"
                name="tags"
                value={edit?.tags.join(", ")}
                description="Separate with commas."
              />
            </FormGrid>
            <Field
              label="Content"
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
          No information has been added to memory yet. Add something you want your Dot to remember.
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
                    Edit
                  </Button>
                  <Action
                    path={`memories/${memory.id}`}
                    method="DELETE"
                    variant="ghost"
                  >
                    Delete
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
      "The run time must be a valid date, e.g. 2026-10-01T09:00:00+03:00",
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
        eyebrow="When the time comes"
        title="Schedules"
        description="One-off or recurring jobs, in the time zone you choose."
        action={
          <Button
            onPress={() => {
              setEdit(null);
              setKind("interval");
            }}
          >
            <PlusIcon />
            Create schedule
          </Button>
        }
      />
      <Notice error={schedules.error} />
      {edit !== undefined && (
        <Section
          title={edit ? "Edit schedule" : "New schedule"}
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
              <Field label="Title" name="title" required value={edit?.title} />
              <SelectField
                label="Schedule type"
                name="kind"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "interval", label: "At intervals" },
                  { value: "once", label: "One time" },
                  { value: "cron", label: "Cron expression" },
                  { value: "rrule", label: "Calendar rule (RRULE)" },
                ]}
              />
              <Field
                label="Time zone"
                name="timezone"
                value={edit?.timezone ?? "Europe/Istanbul"}
                required
              />
              {kind === "interval" && (
                <Field
                  label="Repeat interval (seconds)"
                  name="intervalSeconds"
                  type="number"
                  value={edit?.intervalSeconds ?? 3600}
                  required
                />
              )}
              {kind === "cron" && (
                <Field
                  label="Cron expression"
                  name="cron"
                  value={edit?.cron ?? "0 9 * * *"}
                  required
                  description="Minute hour day month day-of-week"
                />
              )}
              {kind === "rrule" && (
                <Field
                  label="Calendar rule (RRULE)"
                  name="rrule"
                  type="textarea"
                  value={
                    edit?.rrule ?? "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"
                  }
                  required
                  description="An iCalendar RRULE expression. The time zone is applied from the separate field."
                />
              )}
              {kind === "once" && (
                <Field
                  label="Run time (ISO 8601)"
                  name="nextRunAt"
                  value={edit?.nextRunAt ?? ""}
                  required
                  placeholder="2026-10-01T09:00:00+03:00"
                  description="Include the time zone offset as well."
                />
              )}
              <ComputerSelect
                computers={computers.data?.items ?? []}
                value={edit?.computerId}
              />
            </FormGrid>
            <Field
              label="Task instruction"
              name="prompt"
              type="textarea"
              required
              value={edit?.prompt}
            />
            <Check
              name="enabled"
              label="Schedule enabled"
              checked={edit?.enabled ?? true}
            />
            <Check
              name="proactive"
              label="Mark as proactive work"
              checked={edit?.proactive}
            />
          </Form>
        </Section>
      )}
      {schedules.loading && !schedules.data ? (
        <Loading />
      ) : !schedules.data?.items.length ? (
        <Empty>
          No schedules yet. Create a regular follow-up or a one-off job.
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
                        ? (schedule.rrule ?? "Calendar rule")
                        : schedule.kind === "interval"
                          ? `${schedule.intervalSeconds} sec interval`
                          : "One time"}
                  </small>
                  <small className="text-muted">
                    Next: {time(schedule.nextRunAt)} · Last run:{" "}
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
                    {schedule.enabled ? "Pause" : "Enable"}
                  </Action>
                  <Action path={`schedules/${schedule.id}/run`}>
                    Run now
                  </Action>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setEdit(schedule);
                      setKind(schedule.kind);
                    }}
                  >
                    Edit
                  </Button>
                  <Action
                    path={`schedules/${schedule.id}`}
                    method="DELETE"
                    variant="ghost"
                  >
                    Delete
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
        eyebrow="Result of the job"
        title="Outputs"
        description="Files produced by your tasks, straight from your server."
      />
      <div className="max-w-sm">
        <SelectField
          label="Dot"
          value={dotId}
          onChange={setDotId}
          options={[
            { value: "", label: "All Dots" },
            ...(dots.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </div>
      <Notice error={outputs.error} />
      {outputs.loading && !outputs.data ? (
        <Loading />
      ) : !outputs.data?.items.length ? (
        <Empty>
          No outputs yet. Results of tasks that produce files will appear here.
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
                  <small className="truncate text-muted">Task: {output.taskId}</small>
                </div>
              </div>
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href={`/api/backend/outputs/${output.id}/content`}
                download
              >
                Download the file
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
        eyebrow="The last word is yours"
        title="Approvals"
        description="Review the actions your Dot is waiting on you to decide."
      />
      <Notice error={approvals.error} />
      {approvals.loading && !approvals.data ? (
        <Loading />
      ) : !approvals.data?.items.length ? (
        <Empty>There are no actions awaiting approval or recorded.</Empty>
      ) : (
        newest(approvals.data.items).map((approval) => (
          <Section
            key={approval.id}
            title={approval.title}
            description={`${approval.kind} · ${time(approval.createdAt)}`}
            action={<Status value={approval.status} />}
          >
            <p className="preserve text-sm">{approval.detail}</p>
            <Disclose summary="Action details">
              <Json value={approval.request} />
            </Disclose>
            {approval.status === "pending" && (
              <ApprovalDecision approval={approval} />
            )}
            {approval.resolution && (
              <Disclose summary="Submitted answer">
                <Json value={approval.resolution} />
              </Disclose>
            )}
          </Section>
        ))
      )}
    </>
  );
}

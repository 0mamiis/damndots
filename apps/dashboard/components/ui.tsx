"use client";
import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  Disclosure,
  FieldError,
  Form as HeroForm,
  Input,
  Label,
  ListBox,
  Select,
  Skeleton,
  Switch,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { ChevronIcon } from "./icons";

export const ApiContext = createContext({
  serverUrl: "",
  revision: 0,
  mutate: async (
    _path: string,
    _method: string,
    _body?: unknown,
  ): Promise<unknown> => undefined,
});

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: `Sunucu yanıtı: ${response.status}` }));
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : (data.message ?? `Sunucu yanıtı: ${response.status}`),
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export function useData<T>(path: string | null, refreshMs = 0) {
  const { revision } = useContext(ApiContext);
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    let pending = false;
    const controller = new AbortController();
    const refresh = () => {
      if (!current || pending) return;
      pending = true;
      setLoading(true);
      setError("");
      api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        pending = false;
        if (current) setLoading(false);
      });
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    const timer = refreshMs > 0 ? window.setInterval(refreshVisible, refreshMs) : undefined;
    if (refreshMs > 0) {
      window.addEventListener("focus", refreshVisible);
      document.addEventListener("visibilitychange", refreshVisible);
    }
    return () => {
      current = false;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [path, revision, refreshMs]);
  return { data, error, loading };
}

export function saved(message: string) {
  window.dispatchEvent(new Event("dots-toast"));
  setTimeout(() => toast.success(message), 0);
}

export function Notice({ error }: { error: string }) {
  return error ? (
    <Alert status="danger" className="my-2">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>İşlem tamamlanamadı</Alert.Title>
        <Alert.Description className="preserve">{error}</Alert.Description>
      </Alert.Content>
    </Alert>
  ) : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="size-3 rounded-full bg-accent/70 ring-8 ring-accent/10"
      />
      <p className="max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}

export function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">Sunucudan alınıyor…</span>
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-16 w-4/5 rounded-2xl" />
      <Skeleton className="h-16 w-3/5 rounded-2xl" />
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-widest text-accent uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-4">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="text-lg" render={(props) => <h2 {...props} />}>
            {title}
          </Card.Title>
          {description && (
            <Card.Description className="break-words">
              {description}
            </Card.Description>
          )}
        </div>
        {action}
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">{children}</Card.Content>
    </Card>
  );
}

export function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-secondary/50 px-4 py-3 ${className}`}
    >
      {children}
    </div>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Tags({ items }: { items: ReactNode[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <Chip key={index} size="sm" variant="soft">
          {item}
        </Chip>
      ))}
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  placeholder,
  description,
  children,
  rows = 4,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number | null;
  required?: boolean;
  placeholder?: string;
  description?: string;
  children?: ReactNode;
  rows?: number;
}) {
  if (children)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        {children}
        {description && <Description>{description}</Description>}
      </div>
    );
  return (
    <TextField
      fullWidth
      name={name}
      isRequired={required}
      type={type === "textarea" ? "text" : type}
      defaultValue={value == null ? "" : String(value)}
    >
      <Label>{label}</Label>
      {type === "textarea" ? (
        <TextArea
          fullWidth
          rows={rows}
          placeholder={placeholder}
          className="font-mono text-[13px]"
        />
      ) : (
        <Input fullWidth placeholder={placeholder} />
      )}
      {description && <Description>{description}</Description>}
      <FieldError />
    </TextField>
  );
}

/** Controlled text field; the value is also posted with the form. */
export function ControlledField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  rows,
  description,
  required = false,
  disabled = false,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  rows?: number;
  description?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <TextField
      fullWidth
      name={name}
      value={value}
      onChange={onChange}
      type={type}
      isRequired={required}
      isDisabled={disabled}
    >
      <Label>{label}</Label>
      {rows ? (
        <TextArea fullWidth rows={rows} placeholder={placeholder} />
      ) : (
        <Input fullWidth placeholder={placeholder} />
      )}
      {description && <Description>{description}</Description>}
      <FieldError />
    </TextField>
  );
}

export type Option = { value: string; label: string; description?: string };
const EMPTY = "__empty__";

/** HeroUI select that posts its value with the form (an empty string stays selectable). */
export function SelectField({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  description,
  placeholder = "Seçin",
  disabled = false,
  required = false,
}: {
  label: string;
  name?: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  description?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [inner, setInner] = useState<string | undefined>();
  // Options often arrive after the form mounts, so the default is resolved at render time.
  const has = (candidate: string | undefined) =>
    candidate !== undefined && options.some((option) => option.value === candidate);
  const current =
    value ??
    (has(inner)
      ? (inner as string)
      : has(defaultValue)
        ? (defaultValue as string)
        : (options[0]?.value ?? ""));
  const known = options.some((option) => option.value === current);
  return (
    <div className="flex flex-col gap-1.5">
      <Select
        fullWidth
        placeholder={placeholder}
        isDisabled={disabled}
        isRequired={required}
        selectedKey={known ? current || EMPTY : null}
        onSelectionChange={(key) => {
          const next = key === EMPTY || key == null ? "" : String(key);
          setInner(next);
          onChange?.(next);
        }}
      >
        <Label>{label}</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {options.map((option) => (
              <ListBox.Item
                key={option.value || EMPTY}
                id={option.value || EMPTY}
                textValue={option.label}
              >
                {option.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
        {description && <Description>{description}</Description>}
      </Select>
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}

/** A switch that submits as a checkbox: present in FormData only when on. */
export function Check({
  name,
  label,
  checked = false,
  description,
  onChange,
  isSelected,
}: {
  name?: string;
  label: string;
  checked?: boolean;
  description?: string;
  onChange?: (selected: boolean) => void;
  isSelected?: boolean;
}) {
  return (
    <Switch
      name={name}
      value="on"
      defaultSelected={isSelected === undefined ? checked : undefined}
      isSelected={isSelected}
      onChange={onChange}
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <div className="flex flex-col">
          <Label>{label}</Label>
          {description && <Description>{description}</Description>}
        </div>
      </Switch.Content>
    </Switch>
  );
}

/** Replacement for native details: HeroUI Disclosure with the same keyboard behavior. */
export function Disclose({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <Disclosure className="rounded-2xl border border-border bg-surface-secondary/40">
      <Disclosure.Heading>
        <Button
          slot="trigger"
          variant="ghost"
          fullWidth
          className="justify-between rounded-2xl"
        >
          <span className="text-left">{summary}</span>
          <Disclosure.Indicator>
            <ChevronIcon />
          </Disclosure.Indicator>
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content>
        <Disclosure.Body className="flex flex-col gap-3 px-4 pb-4">
          {children}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  );
}

export function Form({
  children,
  onSubmit,
  submit = "Kaydet",
  className = "",
  onDone,
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<unknown>;
  submit?: string;
  className?: string;
  onDone?: () => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await onSubmit(data);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem başarısız.");
    } finally {
      setPending(false);
    }
  }
  return (
    <HeroForm
      className={`flex flex-col gap-4 ${className}`}
      onSubmit={send}
      validationBehavior="native"
    >
      <fieldset
        disabled={pending || disabled}
        className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        {children}
      </fieldset>
      <Notice error={error} />
      <div>
        <Button type="submit" isPending={pending} isDisabled={disabled}>
          {pending ? "İşleniyor…" : submit}
        </Button>
      </div>
    </HeroForm>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 [&>*:only-child]:sm:col-span-2">
      {children}
    </div>
  );
}

export function Action({
  children,
  path,
  method = "POST",
  body,
  variant = "secondary",
}: {
  children: ReactNode;
  path: string;
  method?: string;
  body?: unknown;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const { mutate } = useContext(ApiContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={variant}
        isPending={pending}
        onPress={async () => {
          setPending(true);
          setError("");
          try {
            await mutate(path, method, body);
          } catch (e) {
            setError(e instanceof Error ? e.message : "İşlem başarısız.");
          } finally {
            setPending(false);
          }
        }}
      >
        {children}
      </Button>
      {error && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export const str = (data: FormData, name: string) =>
  String(data.get(name) ?? "");
export const nullable = (data: FormData, name: string) =>
  str(data, name) || null;
export function time(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("tr-TR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export const statuses: Record<string, string> = {
  enabled: "Etkin",
  sent: "Gönderildi",
  sending: "Gönderiliyor",
  delivery_unknown: "Teslim belirsiz",
  approval_required: "Onay gerekli",
  ready: "Hazır",
  agent: "Dot kontrolünde",
  user: "Kontrol sende",
  queued: "Sırada",
  running: "Çalışıyor",
  waiting_approval: "Onay bekliyor",
  paused: "Duraklatıldı",
  completed: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal edildi",
  interrupted: "Kesildi",
  online: "Çevrimiçi",
  offline: "Çevrimdışı",
  pending: "Bekliyor",
  approved: "Onaylandı",
  denied: "Reddedildi",
  expired: "Süresi doldu",
  connected: "Bağlı",
  configured: "Yapılandırıldı",
  needs_configuration: "Kurulum gerekli",
  error: "Hata",
};
type Tone = "default" | "accent" | "success" | "warning" | "danger";
const tones: Record<string, Tone> = {
  completed: "success",
  online: "success",
  connected: "success",
  enabled: "success",
  sent: "success",
  ready: "success",
  approved: "success",
  configured: "success",
  running: "accent",
  sending: "accent",
  agent: "accent",
  queued: "warning",
  waiting_approval: "warning",
  paused: "warning",
  pending: "warning",
  approval_required: "warning",
  delivery_unknown: "warning",
  needs_configuration: "warning",
  user: "warning",
  failed: "danger",
  error: "danger",
  denied: "danger",
  expired: "default",
  offline: "default",
  cancelled: "default",
  interrupted: "default",
};
export function Status({ value }: { value: string }) {
  return (
    <Chip size="sm" variant="soft" color={tones[value] ?? "default"}>
      {statuses[value] ?? value}
    </Chip>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre
      tabIndex={0}
      className="max-h-80 overflow-auto rounded-2xl bg-surface-secondary p-4 font-mono text-xs leading-relaxed"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <pre
      tabIndex={0}
      className="overflow-x-auto rounded-2xl bg-surface-secondary p-4 font-mono text-xs break-all whitespace-pre-wrap"
    >
      {children}
    </pre>
  );
}

export function newest<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function oldest<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

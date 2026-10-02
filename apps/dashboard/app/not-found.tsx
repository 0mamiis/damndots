import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı</h1>
      <p className="text-muted">Aradığın sayfa yok. Çalışma alanına dönebilirsin.</p>
      <Link className="text-accent underline underline-offset-4" href="/">
        Çalışma alanına dön
      </Link>
    </main>
  );
}

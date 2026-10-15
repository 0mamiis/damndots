import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you are looking for does not exist. You can return to the workspace.</p>
      <Link className="text-accent underline underline-offset-4" href="/">
        Back to the workspace
      </Link>
    </main>
  );
}

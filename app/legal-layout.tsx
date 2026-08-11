export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-xl font-bold text-slate-100">{title}</h1>
      <div className="space-y-4 text-sm leading-relaxed text-slate-400">{children}</div>
      <p className="mt-10 border-t border-slate-800 pt-4 text-xs text-slate-600">
        SDLC AI Pipeline · <a href="/" className="hover:text-slate-400">Home</a>
      </p>
    </main>
  );
}

import Link from "next/link";

export default function StudentLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <Link href="/" className="flex min-h-11 items-center gap-2 font-bold text-indigo-800">
            <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-indigo-700 text-white">
              ✓
            </span>
            College Election
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}

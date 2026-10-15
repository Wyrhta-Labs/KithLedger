/** The page title. Sign-out lives in the sidebar footer. */
export default function TopBar({ title }: { title: string }) {
  return (
    <header className="z-[2] flex h-[52px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-4 shadow-card md:px-5">
      <h1 className="text-[15px] font-bold text-fg">{title}</h1>
    </header>
  );
}

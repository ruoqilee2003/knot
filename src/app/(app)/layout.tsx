import { SidebarNav } from "@/components/SidebarNav";

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col bg-[#f4f1eb] md:h-screen md:min-h-0 md:flex-row md:overflow-hidden">
      <div className="shrink-0 md:h-screen">
        <SidebarNav />
      </div>
      <div className="min-h-0 flex-1 bg-[#f4f1eb] md:h-screen md:overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

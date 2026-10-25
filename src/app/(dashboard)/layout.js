import { DashboardLayout } from "@/shared/components";
import { cookies } from "next/headers";

export default async function DashboardRootLayout({ children }) {
  const cookieStore = await cookies();
  const initialCollapsed = cookieStore.get("apirouter_sidebar_collapsed")?.value === "true";

  return (
    <DashboardLayout initialCollapsed={initialCollapsed}>
      {children}
    </DashboardLayout>
  );
}

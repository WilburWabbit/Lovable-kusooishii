import { Link } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { AdminPageHeader } from "@/components/admin-v2/admin-patterns";
import { SurfaceCard } from "@/components/admin-v2/ui-primitives";
import { adminSettingsGroups } from "@/lib/admin-settings-navigation";

export default function SettingsSystemPage() {
  return (
    <AdminV2Layout>
      <AdminPageHeader
        title="Settings/System"
        description="Non-operational administration lives here so daily workspaces stay focused on intake, inventory, orders, finance, and customers."
      />

      <div className="space-y-6">
        {adminSettingsGroups.map((group) => (
          <section key={group.title}>
            <div className="mb-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-zinc-500">{group.title}</h2>
              <p className="mt-1 text-[12px] text-zinc-500">{group.description}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <Link key={item.to} to={item.to} className="block">
                  <SurfaceCard className="h-full">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-900">{item.label}</h3>
                        <p className="mt-1 text-[12px] leading-5 text-zinc-500">{item.detail}</p>
                      </div>
                    </div>
                  </SurfaceCard>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AdminV2Layout>
  );
}

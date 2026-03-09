import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { QboSettingsPanel } from "./QboSettingsPanel";
import { BrickEconomySettingsPanel } from "./BrickEconomySettingsPanel";

export function SettingsPage() {
  return (
    <BackOfficeLayout title="Settings">
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <QboSettingsPanel />
        <BrickEconomySettingsPanel />
      </div>
    </BackOfficeLayout>
  );
}

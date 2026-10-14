import { PageHeader } from '../../shared/ui/PageHeader';

/** Ajustes page: the household legal rates panel goes under this header. */
export default function SettingsView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ajustes" subtitle="Tasas legales y valores de referencia del hogar." />
    </div>
  );
}

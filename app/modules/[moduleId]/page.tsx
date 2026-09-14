import { SalesGymApp } from "@/components/sales-gym-app";

type ModulePageProps = {
  params: Promise<{ moduleId: string }>;
};

export default async function ModulePage({ params }: ModulePageProps) {
  const parsed = Number((await params).moduleId);
  const initialModuleId = Number.isFinite(parsed) ? parsed : undefined;

  return <SalesGymApp initialModuleId={initialModuleId} />;
}

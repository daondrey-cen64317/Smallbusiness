import { Module, ProgressStatus, UserProgress, UserRole } from "@/lib/types";

const MODULES_PER_WEEK = 2;
const TOTAL_MODULES = 8;

export function allowedModuleCount(startedAt: string | null): number {
  if (!startedAt) {
    return MODULES_PER_WEEK;
  }

  const startDate = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsedDays = Math.max(0, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)));
  const unlocked = Math.floor(elapsedDays / 7) * MODULES_PER_WEEK + MODULES_PER_WEEK;

  return Math.min(TOTAL_MODULES, unlocked);
}

export function computeProgressState(
  modules: Module[],
  progressRows: UserProgress[],
  startedAt: string | null,
): Map<string, ProgressStatus> {
  const allowedCount = allowedModuleCount(startedAt);
  const rowByModule = new Map(progressRows.map((row) => [row.module_id, row]));
  const nextState = new Map<string, ProgressStatus>();
  const orderedModules = [...modules].sort((a, b) => a.order_index - b.order_index);
  let previousIsCompleted = true;

  for (const moduleItem of orderedModules) {
    const existing = rowByModule.get(moduleItem.id);

    if (moduleItem.order_index > allowedCount) {
      nextState.set(moduleItem.id, "locked");
      continue;
    }

    if (existing?.status === "completed") {
      nextState.set(moduleItem.id, "completed");
      previousIsCompleted = true;
      continue;
    }

    if (existing?.status === "in_progress") {
      nextState.set(moduleItem.id, "in_progress");
      previousIsCompleted = false;
      continue;
    }

    if (previousIsCompleted) {
      nextState.set(moduleItem.id, "in_progress");
      previousIsCompleted = false;
    } else {
      nextState.set(moduleItem.id, "locked");
    }
  }

  return nextState;
}

export function completionPercentage(progressRows: UserProgress[]): number {
  if (!progressRows.length) {
    return 0;
  }

  const completed = progressRows.filter((row) => row.status === "completed").length;
  return Math.round((completed / progressRows.length) * 100);
}

export function canSeeTlDashboard(role: UserRole): boolean {
  return role === "tl";
}

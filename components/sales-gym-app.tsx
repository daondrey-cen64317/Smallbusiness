"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Session } from "@supabase/supabase-js";
import {
  Award,
  CheckCircle2,
  Clock3,
  Download,
  Lock,
  LogOut,
  Sparkles,
  Video,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  GamificationChallenge,
  Module,
  ModuleTask,
  TaskCompletion,
  Team,
  UserProfile,
  UserProgress,
} from "@/lib/types";
import { allowedModuleCount, canSeeTlDashboard, completionPercentage, computeProgressState } from "@/lib/unlock";

const challengePool = [
  "Udělej dnes stínování u dvou bankéřů a zaměř se na otevřené otázky.",
  "Vyber 3 hovory týmu a dej konkrétní zpětnou vazbu na aktivní naslouchání.",
  "Vytvoř mini-trénink: 10 minut na práci s námitkou 'je to drahé'.",
];

type BankerOverview = {
  id: string;
  full_name: string;
  currentModule: number | null;
  percentage: number;
};

type SalesGymAppProps = {
  initialModuleId?: number;
};

export function SalesGymApp({ initialModuleId }: SalesGymAppProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [tasks, setTasks] = useState<ModuleTask[]>([]);
  const [progress, setProgress] = useState<UserProgress[]>([]);
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletion[]>([]);
  const [challenge, setChallenge] = useState<GamificationChallenge | null>(null);
  const [bankers, setBankers] = useState<BankerOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<number | undefined>(initialModuleId);
  const [showConfetti, setShowConfetti] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());

  const selectedModule = useMemo(() => {
    if (!modules.length) {
      return null;
    }

    if (selectedModuleId) {
      return modules.find((module) => module.order_index === selectedModuleId) ?? null;
    }

    return (
      modules.find((module) => {
        const row = progress.find((item) => item.module_id === module.id);
        return row?.status === "in_progress";
      }) ?? modules[0]
    );
  }, [modules, progress, selectedModuleId]);

  const selectedTasks = useMemo(
    () => tasks.filter((task) => task.module_id === selectedModule?.id),
    [tasks, selectedModule?.id],
  );

  const selectedTaskCompletionSet = useMemo(() => {
    const set = new Set<string>();
    for (const completion of taskCompletions) {
      set.add(completion.task_id);
    }
    return set;
  }, [taskCompletions]);

  const totalCompletion = useMemo(() => completionPercentage(progress), [progress]);

  const progressByModule = useMemo(() => {
    const map = new Map<string, UserProgress>();
    for (const row of progress) {
      map.set(row.module_id, row);
    }
    return map;
  }, [progress]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (clientError) {
      setError(clientError instanceof Error ? clientError.message : "Supabase konfigurace chybí.");
      setLoading(false);
      return;
    }
    const auth = supabase.auth;

    const { data: sessionData, error: sessionError } = await auth.getSession();

    if (sessionError) {
      setError(sessionError.message);
      setLoading(false);
      return;
    }

    if (!sessionData.session) {
      router.push("/login");
      setLoading(false);
      return;
    }

    setSession(sessionData.session);

    const { data: profileRow, error: profileError } = await supabase
      .from("users")
      .select("id, auth_id, full_name, role, team_id, started_at")
      .eq("auth_id", sessionData.session.user.id)
      .maybeSingle();

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    if (!profileRow) {
      setError("K účtu zatím není přiřazen profil v tabulce users.");
      setLoading(false);
      return;
    }

    let normalizedProfile = profileRow;
    if (!profileRow.started_at) {
      const startedAt = new Date().toISOString();
      const { error: startedAtError } = await supabase
        .from("users")
        .update({ started_at: startedAt })
        .eq("id", profileRow.id);

      if (startedAtError) {
        setError(startedAtError.message);
        setLoading(false);
        return;
      }

      normalizedProfile = { ...profileRow, started_at: startedAt };
    }

    setProfile(normalizedProfile);

    const { data: modulesRows, error: modulesError } = await supabase
      .from("modules")
      .select("id, order_index, title, description, video_url, pdf_url")
      .order("order_index");

    if (modulesError) {
      setError(modulesError.message);
      setLoading(false);
      return;
    }

    const { data: taskRows, error: taskError } = await supabase
      .from("tasks")
      .select("id, module_id, description")
      .order("created_at");

    if (taskError) {
      setError(taskError.message);
      setLoading(false);
      return;
    }

    const { data: progressRows, error: progressError } = await supabase
      .from("user_progress")
      .select("id, user_id, module_id, status, completed_at")
      .eq("user_id", normalizedProfile.id);

    if (progressError) {
      setError(progressError.message);
      setLoading(false);
      return;
    }

    if (!progressRows?.length) {
      setError("Profil nemá inicializovaný postup modulů. Požádej administrátora o opravu účtu.");
      setLoading(false);
      return;
    }

    const refreshProgress = await supabase
      .from("user_progress")
      .select("id, user_id, module_id, status, completed_at")
      .eq("user_id", normalizedProfile.id);

    if (refreshProgress.error) {
      setError(refreshProgress.error.message);
      setLoading(false);
      return;
    }

    const computed = computeProgressState(modulesRows, refreshProgress.data ?? [], normalizedProfile.started_at);
    const updates: Array<{ id: string; nextStatus: "locked" | "in_progress" | "completed" }> = [];
    for (const row of refreshProgress.data ?? []) {
      const nextStatus = computed.get(row.module_id);
      if (nextStatus && row.status !== nextStatus) {
        updates.push({ id: row.id, nextStatus });
      }
    }

    if (updates.length) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from("user_progress")
          .update({ status: update.nextStatus })
          .eq("id", update.id);

        if (updateError) {
          setError(updateError.message);
          setLoading(false);
          return;
        }
      }
    }

    const finalProgress = await supabase
      .from("user_progress")
      .select("id, user_id, module_id, status, completed_at")
      .eq("user_id", normalizedProfile.id);

    const { data: completionRows, error: completionError } = await supabase
      .from("task_completions")
      .select("id, user_id, task_id, completed_at")
      .eq("user_id", normalizedProfile.id);

    if (completionError || finalProgress.error) {
      setError(completionError?.message ?? finalProgress.error?.message ?? "Načtení dat selhalo.");
      setLoading(false);
      return;
    }

    setModules(modulesRows);
    setTasks(taskRows ?? []);
    setProgress(finalProgress.data ?? []);
    setTaskCompletions(completionRows ?? []);

    if (normalizedProfile.team_id) {
      const { data: teamRow, error: teamError } = await supabase
        .from("teams")
        .select("id, name, tl_id")
        .eq("id", normalizedProfile.team_id)
        .maybeSingle();
      if (teamError) {
        setError(teamError.message);
        setLoading(false);
        return;
      }
      setTeam(teamRow ?? null);
    } else {
      setTeam(null);
    }

    if (canSeeTlDashboard(normalizedProfile.role)) {
      setBankers([]);
      const { data: challengeRows, error: challengeLoadError } = await supabase
        .from("gamification_challenges")
        .select("id, tl_id, description, status, assigned_at, completed_at")
        .eq("tl_id", normalizedProfile.id)
        .eq("status", "active")
        .order("assigned_at", { ascending: false })
        .limit(1);
      if (challengeLoadError) {
        setError(challengeLoadError.message);
        setLoading(false);
        return;
      }

      if (!challengeRows?.length) {
        const description = challengePool[Math.floor(Math.random() * challengePool.length)];
        const { data: newChallenge, error: challengeInsertError } = await supabase
          .from("gamification_challenges")
          .insert({ tl_id: normalizedProfile.id, description, status: "active" })
          .select("id, tl_id, description, status, assigned_at, completed_at")
          .maybeSingle();
        if (challengeInsertError) {
          setError(challengeInsertError.message);
          setLoading(false);
          return;
        }
        setChallenge(newChallenge ?? null);
      } else {
        setChallenge(challengeRows[0]);
      }

      if (normalizedProfile.team_id) {
        const { data: bankerRows, error: bankerRowsError } = await supabase
          .from("users")
          .select("id, full_name")
          .eq("team_id", normalizedProfile.team_id)
          .eq("role", "banker");
        if (bankerRowsError) {
          setError(bankerRowsError.message);
          setLoading(false);
          return;
        }

        if (bankerRows?.length) {
          const { data: bankerProgressRows, error: bankerProgressError } = await supabase
            .from("user_progress")
            .select("user_id, module_id, status")
            .in(
              "user_id",
              bankerRows.map((banker) => banker.id),
            );
          if (bankerProgressError) {
            setError(bankerProgressError.message);
            setLoading(false);
            return;
          }

          const overview = bankerRows.map((banker) => {
            const rows = (bankerProgressRows ?? []).filter((row) => row.user_id === banker.id);
            const completed = rows.filter((row) => row.status === "completed").length;
            const inProgressModule = modulesRows.find((module) =>
              rows.some((row) => row.module_id === module.id && row.status === "in_progress"),
            );

            return {
              id: banker.id,
              full_name: banker.full_name,
              currentModule: completed >= 8 ? null : (inProgressModule?.order_index ?? Math.min(8, completed + 1)),
              percentage: rows.length ? Math.round((completed / rows.length) * 100) : 0,
            };
          });

          setBankers(overview);
        }
      }
    } else {
      setChallenge(null);
      setBankers([]);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    queueMicrotask(() => {
      void bootstrap();
    });

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        router.push("/login");
      }
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [bootstrap, router]);

  async function toggleTask(taskId: string, checked: boolean) {
    if (!profile || !selectedModule) {
      return;
    }
    if (pendingTaskIds.has(taskId)) {
      return;
    }
    const supabase = getSupabaseClient();
    setPendingTaskIds((prev) => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });

    try {
      if (checked) {
        const { error: insertError } = await supabase
          .from("task_completions")
          .insert({ user_id: profile.id, task_id: taskId });
        if (insertError) {
          setError(insertError.message);
          return;
        }
      } else {
        const { error: deleteError } = await supabase
          .from("task_completions")
          .delete()
          .eq("user_id", profile.id)
          .eq("task_id", taskId);
        if (deleteError) {
          setError(deleteError.message);
          return;
        }
      }

      const { data: completionRows, error: completionLoadError } = await supabase
        .from("task_completions")
        .select("id, user_id, task_id, completed_at")
        .eq("user_id", profile.id);
      if (completionLoadError) {
        setError(completionLoadError.message);
        return;
      }

      setTaskCompletions(completionRows ?? []);

      const moduleTasks = tasks.filter((task) => task.module_id === selectedModule.id).map((task) => task.id);
      const completedCount = (completionRows ?? []).filter((row) => moduleTasks.includes(row.task_id)).length;
      const allDone = moduleTasks.length > 0 && completedCount === moduleTasks.length;

      const currentProgress = progress.find((item) => item.module_id === selectedModule.id);
      if (currentProgress && allDone) {
        const { error: completeError } = await supabase
          .from("user_progress")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", currentProgress.id);
        if (completeError) {
          setError(completeError.message);
          return;
        }

        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 1500);
      }

      if (currentProgress && !allDone && currentProgress.status === "completed") {
        const { error: reopenError } = await supabase
          .from("user_progress")
          .update({ status: "in_progress", completed_at: null })
          .eq("id", currentProgress.id);
        if (reopenError) {
          setError(reopenError.message);
          return;
        }
      }

      await bootstrap();
    } finally {
      setPendingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function signOut() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function markChallengeDone() {
    if (!challenge) {
      return;
    }
    const supabase = getSupabaseClient();

    const { error: challengeError } = await supabase
      .from("gamification_challenges")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", challenge.id);
    if (challengeError) {
      setError(challengeError.message);
      return;
    }

    await bootstrap();
  }

  const allowedCount = allowedModuleCount(profile?.started_at ?? null);

  if (loading) {
    return <main className="mx-auto max-w-6xl p-6 text-sm text-slate-600">Načítání…</main>;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      </main>
    );
  }

  if (!session || !profile) {
    return null;
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {showConfetti ? <Confetti /> : null}

      <header className="mb-6 flex flex-col gap-3 rounded-2xl bg-blue-800 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-blue-100">Sales Gym</p>
          <h1 className="text-xl font-semibold">Ahoj, {profile.full_name}</h1>
          <p className="text-sm text-blue-100">
            Role: {profile.role.toUpperCase()} {team ? `• Tým: ${team.name}` : ""}
          </p>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
        >
          <LogOut className="h-4 w-4" />
          Odhlásit
        </button>
      </header>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Postup programem</h2>
          <span className="text-sm text-slate-600">{totalCompletion}% dokončeno</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {modules.map((module, index) => {
            const moduleProgress = progressByModule.get(module.id);
            const status = moduleProgress?.status ?? "locked";
            const lockedByTime = index + 1 > allowedCount;

            return (
              <Link
                key={module.id}
                href={`/modules/${module.order_index}`}
                aria-disabled={status === "locked"}
                onClick={(event) => {
                  if (status === "locked") {
                    event.preventDefault();
                    return;
                  }
                  setSelectedModuleId(module.order_index);
                }}
                className={`rounded-xl border p-3 text-left text-xs transition ${
                  status === "completed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : status === "in_progress"
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-slate-50 text-slate-400 pointer-events-none"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span>M{module.order_index}</span>
                  {status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : status === "in_progress" ? (
                    <Clock3 className="h-4 w-4" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                </div>
                <p className="line-clamp-3">{module.title}</p>
                {lockedByTime ? <p className="mt-2 text-[10px]">Odemkne se dle harmonogramu</p> : null}
              </Link>
            );
          })}
        </div>
      </section>

      {selectedModule ? (
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Modul {selectedModule.order_index}: {selectedModule.title}
              </h2>
              <p className="mt-1 text-sm text-slate-600">{selectedModule.description}</p>
            </div>
            <a
              href={selectedModule.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Stáhnout tahák ve formátu PDF (otevře se v nové kartě)"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"
            >
              <Download className="h-4 w-4" />
              Tahák (PDF, nová karta)
            </a>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="mb-2 inline-flex items-center gap-2 font-medium text-slate-900">
              <Video className="h-4 w-4 text-blue-700" />
              Video
            </div>
            <p className="break-all">{selectedModule.video_url}</p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Aktivita do praxe</h3>
            <div className="space-y-2">
              {selectedTasks.map((task) => {
                const checked = selectedTaskCompletionSet.has(task.id);

                return (
                  <label
                    key={task.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    aria-busy={pendingTaskIds.has(task.id)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleTask(task.id, event.target.checked)}
                      disabled={pendingTaskIds.has(task.id)}
                      className="mt-1 h-4 w-4 accent-emerald-600 disabled:cursor-wait disabled:opacity-60"
                    />
                    <span>
                      {task.description}
                      {pendingTaskIds.has(task.id) ? (
                        <span className="ml-2 text-xs text-slate-500" role="status" aria-live="polite">
                          Ukládám…
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Další krok</h2>
        <p className="text-sm text-slate-700">
          {selectedModule
            ? `Dokonči modul ${selectedModule.order_index}: nejdřív video, potom všechny aktivity.`
            : "Vyber aktivní modul a pokračuj v aktivitách."}
        </p>
      </section>

      {canSeeTlDashboard(profile.role) ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Postup týmu</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pb-2">Banker</th>
                    <th className="pb-2">Aktuální modul</th>
                    <th className="pb-2">Dokončení</th>
                  </tr>
                </thead>
                <tbody>
                  {bankers.map((banker) => (
                    <tr key={banker.id} className="border-t border-slate-100">
                      <td className="py-2 text-slate-800">{banker.full_name}</td>
                      <td className="py-2 text-slate-600">
                        {banker.currentModule ? `M${banker.currentModule}` : "Dokončeno"}
                      </td>
                      <td className="py-2 text-slate-600">{banker.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Aktivní výzvy</h2>
            {challenge ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 inline-flex items-center gap-2 text-amber-700">
                  <Award className="h-4 w-4" />
                  Gamifikace
                </div>
                <p className="mb-3 text-sm text-amber-900">{challenge.description}</p>
                <button
                  onClick={markChallengeDone}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white"
                >
                  <Sparkles className="h-4 w-4" />
                  Označit jako splněné
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Momentálně není aktivní výzva.</p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: 24 }).map((_, index) => (
        <span
          key={index}
          className="absolute confetti-piece"
          style={{ left: `${(index / 24) * 100}%`, animationDelay: `${(index % 8) * 0.06}s` }}
        />
      ))}
    </div>
  );
}

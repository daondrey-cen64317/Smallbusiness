export type UserRole = "admin" | "tl" | "banker";
export type ProgressStatus = "locked" | "in_progress" | "completed";
export type ChallengeStatus = "active" | "completed";

export type UserProfile = {
  id: string;
  auth_id: string;
  full_name: string;
  role: UserRole;
  team_id: string | null;
  started_at: string | null;
};

export type Team = {
  id: string;
  name: string;
  tl_id: string | null;
};

export type Module = {
  id: string;
  order_index: number;
  title: string;
  description: string | null;
  video_url: string;
  pdf_url: string;
};

export type ModuleTask = {
  id: string;
  module_id: string;
  description: string;
};

export type UserProgress = {
  id: string;
  user_id: string;
  module_id: string;
  status: ProgressStatus;
  completed_at: string | null;
};

export type TaskCompletion = {
  id: string;
  user_id: string;
  task_id: string;
  completed_at: string;
};

export type GamificationChallenge = {
  id: string;
  tl_id: string;
  description: string;
  status: ChallengeStatus;
  assigned_at: string;
  completed_at: string | null;
};

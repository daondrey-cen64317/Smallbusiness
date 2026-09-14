# Sales Gym

Micro-learning web app for banking sales teams built with Next.js, TypeScript, Tailwind, and Supabase.

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres + RLS)
- Lucide Icons

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Set environment variables in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Apply SQL migration in Supabase:

- `supabase/migrations/20260914000100_sales_gym_init.sql`

4. Start app:

```bash
npm run dev
```

## Included features

- Email/password authentication screen
- Role-aware dashboard (Admin, TL, Banker)
- Module timeline with lock/unlock logic (2 modules/week)
- Module detail with video link, Tahák PDF button, and practical task checklist
- Module completion when all practical tasks are checked
- Confetti micro-interaction on module completion
- TL dashboard with team progress overview and active gamification challenge
- Supabase schema with RLS policies and seeded 8 Czech modules + tasks

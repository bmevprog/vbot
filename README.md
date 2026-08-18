# vbot

VProg Discord bot (native TypeScript — run `.ts` directly on Node ≥ 22.18).

- `bot.ts` - main bot: `/cf` forum threads, daily streak problem (`streaks.ts`)
- `contest_reminders.ts` - Codeforces contest reminders (runs in Docker)
- `npm run typecheck` - strict type checking (`tsc --noEmit`), no build step
- Runtime state (handles, streaks, posted problems) lives in `data/` and is gitignored; mount it as a volume if `bot.ts` is ever containerized.

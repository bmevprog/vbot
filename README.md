# vbot

VProg Discord bot in Rust (poise + serenity).

## Features

- `/cf <contest> <forum>` - posts a thread per problem of a Codeforces contest
- `/link <handle>` - link your Codeforces handle to your Discord account
- `/done <link>` - mark today's daily problem as done (verified via Codeforces API)
- `/new` - reroll today's daily problem (mods only)
- `/streaks` - streak leaderboard
- Daily streak problem posted at 1 PM Europe/Budapest
- Codeforces contest reminders (scheduled Discord events + channel pings)


## Environment variables

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_SERVER` | Guild ID for contest reminders |
| `BOT_CHANNEL` | Channel for error reports |
| `CODEFORCES_CHANNEL` | Channel for contest pings |
| `CODEFORCES_ROLE` | Role ID pinged for contests |
| `STREAKS_PROBLEM_CHANNEL` | Channel for the daily problem |
| `STREAKS_ADMIN_ROLE` | Role allowed to reroll the daily problem |
| `DATA_DIR` | Directory for runtime state; in Docker keep it relative (`data`, matching the `./data:/app/data` volume) |
| `PROBLEM_MIN_RATING` / `PROBLEM_MAX_RATING` | Daily problem rating range |
| `UPCOMING_FREQ` | Check interval in ms (e.g. `5*60*1000`) |
| `UPCOMING_DELTA` | Ping window before start in ms |
| `DAILY_NOTIF_HOUR` / `DAILY_NOTIF_MIN` | "Contest tomorrow" ping time (Europe/Budapest) |
| `DAILY_NOTIF_DELTA` | "Contest tomorrow" window in ms |

Durations accept plain milliseconds (`300000`) or multiplication chains (`5*60*1000`).

## Runtime data

State (handles, streaks, daily problem, past problems) lives in `data/`
(gitignored, mounted as a volume in Docker).

## Docker

```
docker compose up -d --build
```

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  EmbedBuilder,
  GuildMember,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
} from "discord.js";
import fetch from "node-fetch";
import schedule, { type Job } from "node-schedule";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, "data");
const HANDLES_FILE = path.join(DATA_DIR, "handles.json");
const STREAKS_FILE = path.join(DATA_DIR, "streaks.json");
const DAILY_FILE = path.join(DATA_DIR, "daily.json");
const PAST_FILE = path.join(DATA_DIR, "past_problems.json");

const TZ = "Europe/Budapest";
const MIN_RATING = 1600;
const MAX_RATING = 2000;
const POST_HOUR = 13;
const POST_MIN = 0;

const { STREAKS_PROBLEM_CHANNEL, STREAKS_ADMIN_ROLE } = process.env;

let candidatesCache: Candidate[] | null = null;
let candidatesCacheAt = 0;
let nextPostJob: Job | null = null;

interface Candidate {
  contestId: number;
  index: string;
  rating: number;
  url: string;
}

interface CFProblem {
  contestId: number;
  index: string;
  rating?: number;
}

interface CFSubmission {
  verdict: string;
  problem?: CFProblem;
  creationTimeSeconds: number;
}

interface CFResponse<T> {
  status: string;
  result: T;
}

interface DailyProblem {
  date: string;
  contestId: number;
  index: string;
  rating: number;
  url: string;
  postedAt: number;
  validUntil: number | null;
}

interface StreakEntry {
  streak: number;
  lastCompleted: string | null;
}

export function initStreaks(client: Client): void {
  if (!STREAKS_PROBLEM_CHANNEL) {
    console.warn("streaks.ts: STREAKS_PROBLEM_CHANNEL not set, daily problem job disabled");
    return;
  }

  nextPostJob = schedule.scheduleJob({ rule: `${POST_MIN} ${POST_HOUR} * * *`, tz: TZ }, async () => {
    try {
      await postDailyProblem(client);
    } catch (error) {
      console.error("Daily problem posting failed:", error);
    }
  });

  catchUp(client);
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  const handle = interaction.options.getString("handle")?.trim();
  if (!handle) {
    await interaction.reply({ content: "Please provide your Codeforces handle.", ephemeral: true });
    return;
  }

  const handles = await readJSON<Record<string, string>>(HANDLES_FILE, {});
  handles[interaction.user.id] = handle;
  await writeJSON(HANDLES_FILE, handles);
  await interaction.reply(`Linked Codeforces handle \`${handle}\` to your account.`);
}

export async function handleDone(interaction: ChatInputCommandInteraction): Promise<void> {
  const link = interaction.options.getString("link");
  const parsed = parseProblemLink(link);
  if (!parsed) {
    await interaction.reply({
      content: "That doesn't look like a valid Codeforces problem link (e.g. https://codeforces.com/contest/1932/problem/A)",
      ephemeral: true,
    });
    return;
  }

  const daily = await readJSON<DailyProblem | null>(DAILY_FILE, null);
  if (!daily || isExpired(daily)) {
    await interaction.reply("There's no active daily problem right now. The next one is posted at 1 PM Budapest.");
    return;
  }

  if (parsed.contestId !== daily.contestId || parsed.index.toUpperCase() !== daily.index.toUpperCase()) {
    await interaction.reply(`That's not the current problem. Current problem: ${daily.url}`);
    return;
  }

  const handles = await readJSON<Record<string, string>>(HANDLES_FILE, {});
  const handle = handles[interaction.user.id];
  if (!handle) {
    await interaction.reply("Link your Codeforces handle first: `/link <handle>`");
    return;
  }

  const streaks = await readJSON<Record<string, StreakEntry>>(STREAKS_FILE, {});
  const entry = streaks[interaction.user.id] ?? { streak: 0, lastCompleted: null };
  if (entry.lastCompleted === daily.date) {
    await interaction.reply(`You already completed this problem. Streak stays at ${entry.streak}.`);
    return;
  }

  await interaction.deferReply();

  let submissions: CFSubmission[];
  try {
    const response = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=100`);
    const data = (await response.json()) as CFResponse<CFSubmission[]>;
    if (data.status !== "OK") {
      await interaction.editReply(`Could not fetch submissions for handle \`${handle}\`. Is it spelled correctly?`);
      return;
    }
    submissions = data.result;
  } catch (error) {
    console.error("Error fetching user.status:", error);
    await interaction.editReply("An error occurred while checking your submissions on Codeforces.");
    return;
  }

  const accepted = submissions.find(
    (s) =>
      s.verdict === "OK" &&
      s.problem &&
      s.problem.contestId === daily.contestId &&
      s.problem.index.toUpperCase() === daily.index.toUpperCase() &&
      s.creationTimeSeconds >= Math.floor(daily.postedAt / 1000)
  );

  if (!accepted) {
    await interaction.editReply("No accepted submission for this problem found. Make sure you solved it on Codeforces and that it was accepted after the problem was posted.");
    return;
  }

  entry.streak = entry.lastCompleted === yesterdayOf(daily.date) ? entry.streak + 1 : 1;
  entry.lastCompleted = daily.date;
  streaks[interaction.user.id] = entry;
  await writeJSON(STREAKS_FILE, streaks);

  await interaction.editReply(`Nice! Your streak is now ${entry.streak} day${entry.streak === 1 ? "" : "s"}.`);
}

export async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  let member = interaction.member;
  if (member && !(member instanceof GuildMember)) {
    member = (await interaction.guild?.members.fetch(interaction.user.id)) ?? null;
  }
  if (!isAdmin(member)) {
    await interaction.reply({ content: "Only mods can reroll the daily problem.", ephemeral: true });
    return;
  }

  await interaction.deferReply();
  try {
    const message = await postDailyProblem(interaction.client, { forceNew: true });
    if (!message) {
      await interaction.editReply("No daily problem has been posted yet today.");
      return;
    }
    await interaction.editReply(`Rerolled today's problem: ${message.url}`);
  } catch (error) {
    console.error("Error rerolling daily problem:", error);
    await interaction.editReply("An error occurred while rerolling the daily problem.");
  }
}

export async function handleStreaks(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply("This command must be used in a server.");
    return;
  }

  const streaks = await readJSON<Record<string, StreakEntry>>(STREAKS_FILE, {});
  const entries = Object.entries(streaks)
    .filter(([, v]) => v.streak > 0)
    .sort((a, b) => b[1].streak - a[1].streak || a[0].localeCompare(b[0]));

  if (!entries.length) {
    await interaction.reply("No streaks yet. Solve today's problem and run `/done <link>` to start one!");
    return;
  }

  const lines: string[] = [];
  for (const [id, v] of entries.slice(0, 10)) {
    let name = id;
    try {
      const member = await guild.members.fetch(id);
      name = member.displayName || member.user.username;
    } catch {}
    lines.push(`${lines.length + 1}. **${name}** - ${v.streak} day${v.streak === 1 ? "" : "s"}`);
  }

  await interaction.reply("**Streak leaderboard**\n" + lines.join("\n"));
}

async function postDailyProblem(client: Client, { forceNew = false } = {}): Promise<Message | null> {
  const today = dateKey();
  const daily = await readJSON<DailyProblem | null>(DAILY_FILE, null);

  if (!forceNew && daily && !isExpired(daily)) {
    return null;
  }

  const past = new Set(await readJSON<string[]>(PAST_FILE, []));

  const candidates = await getCandidates();
  const pool = candidates.filter((p) => !past.has(problemKey(p)));
  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!pool.length || !picked) {
    throw new Error("No unused problems in rating range");
  }
  const key = problemKey(picked);

  await writeJSON(PAST_FILE, [...past, key]);
  const job = nextPostJob;
  if (!job) throw new Error("Daily problem job not initialized");
  const nextInvocation = job.nextInvocation();
  if (!nextInvocation) throw new Error("Daily problem job has no upcoming invocation");
  const validUntil = nextInvocation.getTime();

  await writeJSON(DAILY_FILE, {
    date: today,
    contestId: picked.contestId,
    index: picked.index,
    rating: picked.rating,
    url: picked.url,
    postedAt: Date.now(),
    validUntil,
  });

  if (!STREAKS_PROBLEM_CHANNEL) {
    throw new Error("STREAKS_PROBLEM_CHANNEL is not set");
  }
  const channel = await client.channels.fetch(STREAKS_PROBLEM_CHANNEL);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${STREAKS_PROBLEM_CHANNEL} not found`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Daily Problem")
    .setDescription(picked.url)
    .addFields({ name: "Rating", value: String(picked.rating), inline: true })
    .setFooter({ text: `${today} • Solved it? Run /done <link>` });

  return channel.send({ embeds: [embed] });
}

async function catchUp(client: Client): Promise<void> {
  const tzNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  if (parseInt(tzNow, 10) >= POST_HOUR) {
    try {
      await postDailyProblem(client);
    } catch (error) {
      console.error("Daily problem catch-up failed:", error);
    }
  }
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function dateKey(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

function yesterdayOf(dateStr: string): string {
  const [y = 0, m = 0, d = 0] = dateStr.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(prev);
}

function isExpired(daily: DailyProblem): boolean {
  if (!daily.validUntil) return false;
  return Date.now() >= daily.validUntil;
}

function problemKey(problem: { contestId: number; index: string }): string {
  return `${problem.contestId}${problem.index.toUpperCase()}`;
}

async function getCandidates(): Promise<Candidate[]> {
  if (candidatesCache && Date.now() - candidatesCacheAt < 6 * 60 * 60 * 1000) {
    return candidatesCache;
  }

  const response = await fetch("https://codeforces.com/api/problemset.problems");
  const data = (await response.json()) as CFResponse<{ problems: CFProblem[] }>;
  if (data.status !== "OK") {
    throw new Error("problemset.problems request failed");
  }

  candidatesCache = data.result.problems
    .filter(
      (p): p is CFProblem & { rating: number } =>
        typeof p.rating === "number" && p.rating >= MIN_RATING && p.rating <= MAX_RATING
    )
    .map((p) => ({
      contestId: p.contestId,
      index: p.index,
      rating: p.rating,
      url: `https://codeforces.com/contest/${p.contestId}/problem/${p.index}`,
    }));
  candidatesCacheAt = Date.now();
  return candidatesCache;
}

function parseProblemLink(link: string | null): { contestId: number; index: string } | null {
  const match = String(link).match(/codeforces\.com\/(?:contest|problemset|gym)\/(\d+)\/problem\/([A-Za-z0-9]+)/i);
  if (!match) return null;
  return { contestId: parseInt(match[1] ?? "", 10), index: match[2] ?? "" };
}

function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  if (STREAKS_ADMIN_ROLE) {
    return member.roles.cache.some((r) => r.name.toLowerCase() === STREAKS_ADMIN_ROLE.toLowerCase());
  }
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

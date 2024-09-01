import {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType
} from "discord.js";

function contest2event(codeforces_contest) {
  return {
    name: codeforces_contest.name,
    start: new Date(codeforces_contest.startTimeSeconds * 1000),
    end: new Date((codeforces_contest.startTimeSeconds + codeforces_contest.durationSeconds) * 1000),
    url: `https://codeforces.com/contests/${codeforces_contest.id}`
  };
}

function event2discord(event) {
  return {
    name: event.name,
    scheduledStartTime: event.start,
    scheduledEndTime: event.end,
    description: '',
    entityMetadata: { location: event.url },
    image: null,
    reason: 'Codeforces contest',
    entityType: GuildScheduledEventEntityType.External,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
  };
}

export { contest2event, event2discord }

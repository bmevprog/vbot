use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serenity::all::{
    ChannelId, CreateScheduledEvent, EditScheduledEvent, GetMessages, GuildId, Http,
    ScheduledEventId, ScheduledEventPrivacyLevel, ScheduledEventType, Timestamp,
};
use std::sync::Arc;
use std::time::Duration;

use crate::commands::Data;
use crate::streaks::next_notify_at;

#[derive(Clone)]
struct ContestEvent {
    name: String,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    url: String,
}

impl ContestEvent {
    fn from_contest(contest: &crate::codeforces::Contest) -> Self {
        Self {
            name: contest.name.clone(),
            start: DateTime::from_timestamp(contest.start_time_seconds, 0).unwrap_or_default(),
            end: DateTime::from_timestamp(
                contest.start_time_seconds + contest.duration_seconds,
                0,
            )
            .unwrap_or_default(),
            url: format!("https://codeforces.com/contests/{}", contest.id),
        }
    }
}

struct CFEvent {
    id: ScheduledEventId,
    url: String,
    start: Timestamp,
}

/// All scheduled events in the guild whose location points at Codeforces.
async fn cf_events(http: &Http, server: u64) -> Vec<CFEvent> {
    let Ok(events) = GuildId::new(server).scheduled_events(http, false).await else {
        return Vec::new();
    };
    events
        .into_iter()
        .filter_map(|event| {
            let url = event.metadata.as_ref().and_then(|m| m.location.clone())?;
            if !url.contains("codeforces.com") {
                return None;
            }
            Some(CFEvent {
                id: event.id,
                url,
                start: event.start_time,
            })
        })
        .collect()
}

pub async fn run_reminders(data: Arc<Data>) {
    let http = Arc::new(Http::new(&data.config.discord_token));

    let freq = if data.config.upcoming_freq.is_zero() {
        Duration::from_secs(5 * 60)
    } else {
        data.config.upcoming_freq
    };

    let data_upcoming = data.clone();
    let http_upcoming = http.clone();
    let upcoming = tokio::spawn(async move {
        let mut interval = tokio::time::interval(freq);
        loop {
            interval.tick().await;
            ping_upcoming(&data_upcoming, &http_upcoming).await;
        }
    });

    loop {
        let now = Utc::now();
        let next = next_notify_at(now, data.config.daily_notif_hour, data.config.daily_notif_min);
        let duration = (next - now).to_std().unwrap_or_default();
        tokio::time::sleep(duration).await;
        ping_tomorrow(&data, &http).await;
        let _ = &upcoming;
    }
}

async fn update_discord_events(data: &Arc<Data>, http: &Http) -> anyhow::Result<()> {
    let guild_id = GuildId::new(data.config.discord_server);
    let contests: Vec<ContestEvent> = data
        .config
        .store
        .codeforces
        .upcoming_contests()
        .await?
        .iter()
        .map(ContestEvent::from_contest)
        .collect();

    let events = cf_events(http, data.config.discord_server).await;
    let mut remaining: Vec<ContestEvent> = contests.clone();

    for event in events {
        let Some(contest) = remaining.iter().find(|c| c.url == event.url).cloned() else {
            continue;
        };
        let edit = EditScheduledEvent::new()
            .name(&contest.name)
            .description("")
            .kind(ScheduledEventType::External)
            .start_time(Timestamp::from(contest.start))
            .end_time(Timestamp::from(contest.end))
            .location(&contest.url)
            .privacy_level(ScheduledEventPrivacyLevel::GuildOnly);
        guild_id
            .edit_scheduled_event(http, event.id, edit)
            .await?;
        tracing::info!("{} updated", contest.name);
        remaining.retain(|c| c.url != event.url);
    }

    for contest in remaining {
        let create = CreateScheduledEvent::new(
            ScheduledEventType::External,
            &contest.name,
            Timestamp::from(contest.start),
        )
        .description("")
        .end_time(Timestamp::from(contest.end))
        .location(&contest.url);
        guild_id.create_scheduled_event(http, create).await?;
        tracing::info!("{} created", contest.name);
    }

    Ok(())
}

async fn ping_upcoming(data: &Arc<Data>, http: &Http) {
    let channel_id = data.config.codeforces_channel;
    let server = data.config.discord_server;
    let role = data.config.codeforces_role;

    let channel = ChannelId::new(channel_id);
    let role_mention = format!("<@&{role}> ");

    let notified: Vec<String> = match channel
        .messages(http, GetMessages::new().limit(100))
        .await
    {
        Ok(messages) => messages
            .iter()
            .filter(|m| m.content.contains("codeforces.com"))
            .filter(|m| m.content.contains("starting"))
            .filter_map(|m| {
                m.content
                    .split(' ')
                    .find(|word| word.contains("codeforces.com"))
                    .map(|word| word.to_string())
            })
            .collect(),
        Err(error) => {
            send_error(data, http, "Starting", &error.to_string()).await;
            return;
        }
    };

    let events = cf_events(http, server).await;
    let now = Utc::now();

    for event in events {
        if notified.iter().any(|n| n.contains(&event.url)) {
            continue;
        }
        let delta = ChronoDuration::seconds(event.start.unix_timestamp() - now.timestamp());
        let window = ChronoDuration::from_std(data.config.upcoming_delta).unwrap_or_default();
        if delta < ChronoDuration::zero() || delta > window {
            continue;
        }

        let timestamp = format!("<t:{}:R>", event.start.unix_timestamp());
        let _ = channel
            .say(
                http,
                format!("{role_mention}{} starting {timestamp}, **register**!", event.url),
            )
            .await;
    }
}

async fn ping_tomorrow(data: &Arc<Data>, http: &Http) {
    let channel_id = data.config.codeforces_channel;
    let server = data.config.discord_server;
    let role = data.config.codeforces_role;

    if let Err(error) = update_discord_events(data, http).await {
        tracing::error!("Contest reminders: update error: {error}");
        send_error(data, http, "Codeforces update", &error.to_string()).await;
    }

    let channel = ChannelId::new(channel_id);
    let role_mention = format!("<@&{role}> ");

    let events = cf_events(http, server).await;
    let now = Utc::now();

    for event in events {
        let delta = ChronoDuration::seconds(event.start.unix_timestamp() - now.timestamp());
        let window = ChronoDuration::from_std(data.config.daily_notif_delta).unwrap_or_default();
        if delta < ChronoDuration::zero() || delta > window {
            continue;
        }

        let timestamp = format!("<t:{}:t>", event.start.unix_timestamp());
        let _ = channel
            .say(
                http,
                format!("{role_mention}{} at {timestamp} tomorrow.", event.url),
            )
            .await;
    }
}

async fn send_error(data: &Arc<Data>, http: &Http, context: &str, message: &str) {
    let _ = ChannelId::new(data.config.bot_channel)
        .say(
            http,
            format!("Contest reminders: {context} error:\n{message}"),
        )
        .await;
}

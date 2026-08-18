use anyhow::bail;
use chrono::{DateTime, Days, LocalResult, NaiveDate, Utc};
use chrono_tz::{Europe, Tz};
use rand::RngExt;
use serenity::all::{ChannelId, Colour, CreateEmbed, CreateMessage, Message};

use crate::codeforces::Candidate;
use crate::data::{DailyProblem, Store};

pub const TZ: Tz = Europe::Budapest;
pub const POST_HOUR: u32 = 13;

pub fn date_key(now: DateTime<Utc>) -> String {
    now.with_timezone(&TZ).format("%Y-%m-%d").to_string()
}

pub fn yesterday_of(date: &str) -> Option<String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()?
        .pred_opt()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// The next `hour:minute` Europe/Budapest strictly after `now`, as UTC. DST-safe.
pub fn next_notify_at(now: DateTime<Utc>, hour: u32, minute: u32) -> DateTime<Utc> {
    let bud = now.with_timezone(&TZ);
    let mut day = bud.date_naive();
    loop {
        if let Some(naive) = day.and_hms_opt(hour, minute, 0) {
            match naive.and_local_timezone(TZ) {
                LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => {
                    let utc = dt.with_timezone(&Utc);
                    if utc > now {
                        return utc;
                    }
                }
                LocalResult::None => {}
            }
        }
        day = day + Days::new(1);
    }
}

/// The next 13:00 Europe/Budapest strictly after `now`, as UTC.
pub fn next_post_at(now: DateTime<Utc>) -> DateTime<Utc> {
    next_notify_at(now, POST_HOUR, 0)
}

pub fn is_expired(daily: &DailyProblem) -> bool {
    Utc::now().timestamp_millis() >= daily.valid_until
}

pub fn problem_key(contest_id: i64, index: &str) -> String {
    format!("{}{}", contest_id, index.to_uppercase())
}

pub async fn post_daily_problem(
    store: &Store,
    channel_id: u64,
    http: &serenity::all::Http,
    force_new: bool,
) -> anyhow::Result<Option<Message>> {
    let now = Utc::now();
    let today = date_key(now);

    let daily = store.daily();
    if !force_new && daily.as_ref().is_some_and(|d| !is_expired(d)) {
        return Ok(None);
    }

    let past = store.past_problems();
    let candidates = store.codeforces.problemset().await?;
    let pool: Vec<&Candidate> = candidates
        .iter()
        .filter(|c| !past.contains(&problem_key(c.contest_id, &c.index)))
        .collect();
    if pool.is_empty() {
        bail!("No unused problems in rating range");
    }
    let picked = pool[rand::rng().random_range(0..pool.len())].clone();

    let mut new_past = past;
    new_past.push(problem_key(picked.contest_id, &picked.index));
    store.save_past_problems(&new_past)?;

    let valid_until = next_post_at(Utc::now()).timestamp_millis();
    let daily = DailyProblem {
        date: today.clone(),
        contest_id: picked.contest_id,
        index: picked.index.clone(),
        rating: picked.rating,
        url: picked.url.clone(),
        posted_at: now.timestamp_millis(),
        valid_until,
    };
    store.save_daily(&daily)?;

    let embed = CreateEmbed::new()
        .color(Colour::new(0x2ecc71))
        .title("Daily Problem")
        .description(&picked.url)
        .field("Rating", picked.rating.to_string(), true)
        .footer(serenity::all::CreateEmbedFooter::new(format!(
            "{today} • Solved it? Run /done <link>"
        )));
    let message = ChannelId::new(channel_id)
        .send_message(http, CreateMessage::new().embed(embed))
        .await?;

    Ok(Some(message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDateTime, TimeZone};

    fn utc(s: &str) -> DateTime<Utc> {
        Utc.from_utc_datetime(&NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap())
    }

    #[test]
    fn next_notify_at_same_day() {
        let now = utc("2026-08-18 08:00:00");
        assert_eq!(next_notify_at(now, 13, 0), utc("2026-08-18 11:00:00"));
    }

    #[test]
    fn next_notify_at_rolls_to_next_day() {
        let now = utc("2026-08-18 12:00:00");
        assert_eq!(next_notify_at(now, 13, 0), utc("2026-08-19 11:00:00"));
    }

    #[test]
    fn next_notify_at_exactly_at_target_is_strict() {
        let now = utc("2026-08-18 11:00:00");
        assert_eq!(next_notify_at(now, 13, 0), utc("2026-08-19 11:00:00"));
    }

    #[test]
    fn next_notify_at_after_spring_forward() {
        let now = utc("2026-03-28 23:00:00");
        assert_eq!(next_notify_at(now, 13, 0), utc("2026-03-29 11:00:00"));
    }

    #[test]
    fn next_notify_at_skips_nonexistent_local_time() {
        let now = utc("2026-03-28 23:00:00");
        assert_eq!(next_notify_at(now, 2, 30), utc("2026-03-30 00:30:00"));
    }

    #[test]
    fn next_notify_at_disambiguates_fall_back() {
        let now = utc("2026-10-24 23:00:00");
        assert_eq!(next_notify_at(now, 2, 30), utc("2026-10-25 00:30:00"));
    }

    #[test]
    fn next_post_at_is_13_budapest() {
        let now = utc("2026-08-18 08:00:00");
        assert_eq!(next_post_at(now), utc("2026-08-18 11:00:00"));
    }

    #[test]
    fn date_key_uses_budapest_date() {
        let late = utc("2026-08-18 22:30:00");
        assert_eq!(date_key(late), "2026-08-19");
        let dst_night = utc("2026-03-28 23:30:00");
        assert_eq!(date_key(dst_night), "2026-03-29");
    }

    #[test]
    fn yesterday_of_handles_month_boundary() {
        assert_eq!(yesterday_of("2026-08-18").as_deref(), Some("2026-08-17"));
        assert_eq!(yesterday_of("2026-03-01").as_deref(), Some("2026-02-28"));
        assert_eq!(yesterday_of("garbage"), None);
    }

    #[test]
    fn problem_key_uppercases_index() {
        assert_eq!(problem_key(1932, "A"), "1932A");
        assert_eq!(problem_key(1932, "a"), "1932A");
        assert_eq!(problem_key(1, "A2"), "1A2");
    }

    #[test]
    fn is_expired_compares_valid_until() {
        let future = DailyProblem {
            date: "2026-08-18".into(),
            contest_id: 1932,
            index: "A".into(),
            rating: 1600,
            url: "https://codeforces.com/contest/1932/problem/A".into(),
            posted_at: 0,
            valid_until: 1_000_000_000_000_000,
        };
        assert!(!is_expired(&future));
        let past = DailyProblem {
            valid_until: 0,
            ..future
        };
        assert!(is_expired(&past));
    }
}

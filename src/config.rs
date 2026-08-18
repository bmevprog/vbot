use anyhow::{anyhow, bail};
use std::path::PathBuf;
use std::time::Duration;

use crate::data::Store;

#[derive(Clone, Debug)]
pub struct Config {
    pub discord_token: String,
    pub discord_server: u64,
    pub bot_channel: u64,
    pub codeforces_channel: u64,
    pub codeforces_role: u64,
    pub streaks_problem_channel: u64,
    pub streaks_admin_role: String,
    pub store: Store,
    pub upcoming_freq: Duration,
    pub upcoming_delta: Duration,
    pub daily_notif_hour: u32,
    pub daily_notif_min: u32,
    pub daily_notif_delta: Duration,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

fn required<T>(key: &str, parse: fn(&str) -> Option<T>) -> anyhow::Result<T> {
    let value = env(key).ok_or_else(|| anyhow!("{key} is missing"))?;
    parse(&value).ok_or_else(|| anyhow!("{key} is invalid (got \"{value}\")"))
}

fn parse_string(value: &str) -> Option<String> {
    Some(value.to_string())
}

fn parse_u64(value: &str) -> Option<u64> {
    value.trim().parse().ok()
}

fn parse_i64(value: &str) -> Option<i64> {
    value.trim().parse().ok()
}

fn parse_u32(value: &str) -> Option<u32> {
    value.trim().parse().ok()
}

fn parse_duration_ms(value: &str) -> Option<Duration> {
    // Accept plain milliseconds ("300000") or multiplication chains ("5*60*1000").
    let parts: Vec<&str> = value.split('*').map(str::trim).collect();
    if parts.is_empty() || parts.iter().any(|part| part.parse::<u64>().is_err()) {
        return None;
    }
    let ms = parts
        .iter()
        .filter_map(|part| part.parse::<u64>().ok())
        .product::<u64>();
    Some(Duration::from_millis(ms))
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let problem_min_rating = required("PROBLEM_MIN_RATING", parse_i64)?;
        let problem_max_rating = required("PROBLEM_MAX_RATING", parse_i64)?;
        if problem_min_rating >= problem_max_rating {
            bail!(
                "PROBLEM_MIN_RATING ({problem_min_rating}) must be lower than PROBLEM_MAX_RATING ({problem_max_rating})"
            );
        }

        Ok(Self {
            discord_token: required("DISCORD_TOKEN", parse_string)?,
            discord_server: required("DISCORD_SERVER", parse_u64)?,
            bot_channel: required("BOT_CHANNEL", parse_u64)?,
            codeforces_channel: required("CODEFORCES_CHANNEL", parse_u64)?,
            codeforces_role: required("CODEFORCES_ROLE", parse_u64)?,
            streaks_problem_channel: required("STREAKS_PROBLEM_CHANNEL", parse_u64)?,
            streaks_admin_role: required("STREAKS_ADMIN_ROLE", parse_string)?,
            store: Store::new(
                PathBuf::from(required("DATA_DIR", parse_string)?),
                problem_min_rating,
                problem_max_rating,
            ),
            upcoming_freq: required("UPCOMING_FREQ", parse_duration_ms)?,
            upcoming_delta: required("UPCOMING_DELTA", parse_duration_ms)?,
            daily_notif_hour: required("DAILY_NOTIF_HOUR", parse_u32)?,
            daily_notif_min: required("DAILY_NOTIF_MIN", parse_u32)?,
            daily_notif_delta: required("DAILY_NOTIF_DELTA", parse_duration_ms)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn parse_duration_ms_accepts_plain_and_chains() {
        assert_eq!(parse_duration_ms("300000"), Some(Duration::from_millis(300_000)));
        assert_eq!(
            parse_duration_ms("5*60*1000"),
            Some(Duration::from_millis(300_000))
        );
        assert_eq!(parse_duration_ms("5*60"), Some(Duration::from_millis(300)));
        assert_eq!(
            parse_duration_ms(" 5 * 60 "),
            Some(Duration::from_millis(300))
        );
        assert_eq!(parse_duration_ms("0"), Some(Duration::from_millis(0)));
    }

    #[test]
    fn parse_duration_ms_rejects_junk() {
        assert_eq!(parse_duration_ms("abc"), None);
        assert_eq!(parse_duration_ms("5*60*"), None);
        assert_eq!(parse_duration_ms("5**60"), None);
        assert_eq!(parse_duration_ms(""), None);
        assert_eq!(parse_duration_ms("5*-1"), None);
    }

    #[test]
    fn parse_helpers_reject_non_numbers() {
        assert_eq!(parse_u64("42"), Some(42));
        assert_eq!(parse_u64("abc"), None);
        assert_eq!(parse_i64("-7"), Some(-7));
        assert_eq!(parse_u32("4294967296"), None);
        assert_eq!(parse_string("abc"), Some("abc".to_string()));
    }

    #[test]
    fn required_distinguishes_missing_from_invalid() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("VBOT_TEST_REQUIRED_OK");
        std::env::remove_var("VBOT_TEST_REQUIRED_BAD");
        std::env::set_var("VBOT_TEST_REQUIRED_OK", "7");
        std::env::set_var("VBOT_TEST_REQUIRED_BAD", "not-a-number");
        let ok = required("VBOT_TEST_REQUIRED_OK", parse_u64).unwrap();
        assert_eq!(ok, 7);
        let missing = required("VBOT_TEST_REQUIRED_GONE", parse_u64).unwrap_err();
        assert!(missing.to_string().contains("is missing"));
        let invalid = required("VBOT_TEST_REQUIRED_BAD", parse_u64).unwrap_err();
        assert!(invalid.to_string().contains("is invalid"));
    }

    #[test]
    fn from_env_parses_all_fields() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("DISCORD_TOKEN", "tok");
        std::env::set_var("DISCORD_SERVER", "123");
        std::env::set_var("BOT_CHANNEL", "1");
        std::env::set_var("CODEFORCES_CHANNEL", "2");
        std::env::set_var("CODEFORCES_ROLE", "3");
        std::env::set_var("STREAKS_PROBLEM_CHANNEL", "4");
        std::env::set_var("STREAKS_ADMIN_ROLE", "mod");
        std::env::set_var("DATA_DIR", "/tmp/vbot-test");
        std::env::set_var("PROBLEM_MIN_RATING", "1600");
        std::env::set_var("PROBLEM_MAX_RATING", "2000");
        std::env::set_var("UPCOMING_FREQ", "5*60*1000");
        std::env::set_var("UPCOMING_DELTA", "300000");
        std::env::set_var("DAILY_NOTIF_HOUR", "22");
        std::env::set_var("DAILY_NOTIF_MIN", "0");
        std::env::set_var("DAILY_NOTIF_DELTA", "300000");

        let config = Config::from_env().unwrap();
        assert_eq!(config.discord_token, "tok");
        assert_eq!(config.discord_server, 123);
        assert_eq!(config.bot_channel, 1);
        assert_eq!(config.codeforces_channel, 2);
        assert_eq!(config.codeforces_role, 3);
        assert_eq!(config.streaks_problem_channel, 4);
        assert_eq!(config.streaks_admin_role, "mod");
        assert_eq!(config.upcoming_freq, Duration::from_millis(300_000));
        assert_eq!(config.upcoming_delta, Duration::from_millis(300_000));
        assert_eq!(config.daily_notif_hour, 22);
        assert_eq!(config.daily_notif_min, 0);
        assert_eq!(config.daily_notif_delta, Duration::from_millis(300_000));
    }

    #[test]
    fn from_env_rejects_inverted_ratings() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("PROBLEM_MIN_RATING", "2000");
        std::env::set_var("PROBLEM_MAX_RATING", "1600");
        std::env::set_var("DISCORD_TOKEN", "tok");
        std::env::set_var("UPCOMING_FREQ", "1000");
        std::env::set_var("UPCOMING_DELTA", "1000");
        std::env::set_var("DAILY_NOTIF_DELTA", "1000");
        let err = Config::from_env().unwrap_err();
        assert!(err.to_string().contains("must be lower"));
    }
}

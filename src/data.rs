use anyhow::anyhow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::codeforces::Codeforces;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DailyProblem {
    pub date: String,
    pub contest_id: i64,
    pub index: String,
    pub rating: i64,
    pub url: String,
    pub posted_at: i64,
    pub valid_until: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StreakEntry {
    pub streak: u32,
    pub last_completed: Option<String>,
}

pub type Streaks = HashMap<String, StreakEntry>;
pub type Handles = HashMap<String, String>;
pub type PastProblems = Vec<String>;

#[derive(Clone, Debug)]
pub struct Store {
    pub dir: PathBuf,
    pub codeforces: Codeforces,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            codeforces: Codeforces::new(),
        }
    }

    pub fn daily(&self) -> Option<DailyProblem> {
        read_json(&self.dir.join("daily.json"))
    }

    pub fn handles(&self) -> Handles {
        read_json(&self.dir.join("handles.json")).unwrap_or_default()
    }

    pub fn streaks(&self) -> Streaks {
        read_json(&self.dir.join("streaks.json")).unwrap_or_default()
    }

    pub fn past_problems(&self) -> PastProblems {
        read_json(&self.dir.join("past_problems.json")).unwrap_or_default()
    }

    pub fn save_daily(&self, daily: &DailyProblem) -> anyhow::Result<()> {
        write_json(&self.dir.join("daily.json"), daily)
    }

    pub fn save_handles(&self, handles: &Handles) -> anyhow::Result<()> {
        write_json(&self.dir.join("handles.json"), handles)
    }

    pub fn save_streaks(&self, streaks: &Streaks) -> anyhow::Result<()> {
        write_json(&self.dir.join("streaks.json"), streaks)
    }

    pub fn save_past_problems(&self, past: &PastProblems) -> anyhow::Result<()> {
        write_json(&self.dir.join("past_problems.json"), past)
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_json<T: Serialize>(path: &Path, data: &T) -> anyhow::Result<()> {
    let dir = path.parent().ok_or_else(|| anyhow!("invalid data path"))?;
    fs::create_dir_all(dir)?;
    let content = serde_json::to_string_pretty(data)?;
    fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vbot-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = temp_dir("roundtrip");
        let store = Store::new(dir.clone());

        let daily = DailyProblem {
            date: "2026-08-18".into(),
            contest_id: 1932,
            index: "A".into(),
            rating: 1600,
            url: "https://codeforces.com/contest/1932/problem/A".into(),
            posted_at: 1,
            valid_until: 2,
        };
        store.save_daily(&daily).unwrap();
        assert_eq!(store.daily().unwrap().url, daily.url);

        store
            .save_handles(&HashMap::from([("123".into(), "tourist".into())]))
            .unwrap();
        assert_eq!(store.handles().get("123").unwrap(), "tourist");

        store
            .save_streaks(&HashMap::from([(
                "123".into(),
                StreakEntry {
                    streak: 3,
                    last_completed: Some("2026-08-17".into()),
                },
            )]))
            .unwrap();
        assert_eq!(store.streaks().get("123").unwrap().streak, 3);

        store.save_past_problems(&vec!["1932A".into()]).unwrap();
        assert_eq!(store.past_problems(), vec!["1932A".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_old_typescript_camelcase_json() {
        let dir = temp_dir("ts-compat");
        fs::write(
            dir.join("daily.json"),
            r#"{
  "date": "2026-08-18",
  "contestId": 1932,
  "index": "A",
  "rating": 1600,
  "url": "https://codeforces.com/contest/1932/problem/A",
  "postedAt": 1787000000000,
  "validUntil": 1787086800000
}"#,
        )
        .unwrap();
        fs::write(
            dir.join("streaks.json"),
            r#"{
  "123": { "streak": 5, "lastCompleted": "2026-08-17" }
}"#,
        )
        .unwrap();
        fs::write(
            dir.join("handles.json"),
            r#"{
  "123": "tourist"
}"#,
        )
        .unwrap();
        fs::write(dir.join("past_problems.json"), r#"["1932A", "1931B"]"#).unwrap();

        let store = Store::new(dir.clone());
        let daily = store.daily().unwrap();
        assert_eq!(daily.contest_id, 1932);
        assert_eq!(daily.valid_until, 1787086800000);
        assert_eq!(daily.posted_at, 1787000000000);

        let streaks = store.streaks();
        let streak = streaks.get("123").unwrap();
        assert_eq!(streak.streak, 5);
        assert_eq!(streak.last_completed.as_deref(), Some("2026-08-17"));

        assert_eq!(store.handles().get("123").unwrap(), "tourist");
        assert_eq!(store.past_problems(), vec!["1932A", "1931B"]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_or_corrupt_files_fall_back_safely() {
        let dir = temp_dir("missing");
        let store = Store::new(dir.clone());
        assert!(store.daily().is_none());
        assert!(store.handles().is_empty());
        assert!(store.streaks().is_empty());
        assert!(store.past_problems().is_empty());

        fs::write(dir.join("daily.json"), "not json{").unwrap();
        assert!(store.daily().is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}

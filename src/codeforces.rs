use anyhow::{anyhow, bail};
use serde::Deserialize;

#[derive(Deserialize, Clone)]
pub struct CFProblem {
    #[serde(rename = "contestId")]
    pub contest_id: i64,
    pub index: String,
    pub rating: Option<i64>,
}

#[derive(Deserialize, Clone)]
pub struct CFSubmission {
    pub id: i64,
    pub verdict: String,
    pub problem: Option<CFProblem>,
    #[serde(rename = "creationTimeSeconds")]
    pub creation_time_seconds: i64,
}

#[derive(Deserialize, Clone)]
pub struct StandingsProblem {
    pub index: String,
    pub name: String,
}

#[derive(Deserialize, Clone)]
pub struct StandingsContest {
    pub id: i64,
    pub name: String,
}

#[derive(Deserialize, Clone)]
pub struct StandingsResult {
    pub contest: StandingsContest,
    pub problems: Vec<StandingsProblem>,
}

#[derive(Deserialize, Clone)]
pub struct Contest {
    pub id: i64,
    pub name: String,
    #[serde(rename = "startTimeSeconds")]
    pub start_time_seconds: i64,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: i64,
    pub phase: String,
}

#[derive(Deserialize)]
struct ProblemsetResult {
    problems: Vec<CFProblem>,
}

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    status: String,
    result: Option<T>,
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub contest_id: i64,
    pub index: String,
    pub rating: i64,
    pub url: String,
}

#[derive(Clone, Debug)]
pub struct Codeforces {
    pub client: reqwest::Client,
    pub min_rating: i64,
    pub max_rating: i64,
    pub candidates_cache: std::sync::Arc<std::sync::Mutex<Option<(std::time::Instant, Vec<Candidate>)>>>,
}

impl Codeforces {
    pub fn new(min_rating: i64, max_rating: i64) -> Self {
        Self {
            client: reqwest::Client::new(),
            min_rating,
            max_rating,
            candidates_cache: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub fn candidates_cache_age(&self) -> Option<std::time::Duration> {
        self.candidates_cache
            .lock()
            .unwrap()
            .as_ref()
            .map(|(at, _)| at.elapsed())
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, url: &str) -> anyhow::Result<T> {
        let response = self.client.get(url).send().await?;
        let envelope: ApiEnvelope<T> = response.json().await?;
        if envelope.status != "OK" {
            bail!("Codeforces API error: {}", envelope.status);
        }
        envelope
            .result
            .ok_or_else(|| anyhow!("Codeforces API returned no result"))
    }

    pub async fn problemset(&self) -> anyhow::Result<Vec<Candidate>> {
        if let Some((at, cached)) = self.candidates_cache.lock().unwrap().as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(6 * 60 * 60) {
                return Ok(cached.clone());
            }
        }

        let result: ProblemsetResult = self
            .get(&format!("{}problemset.problems", API_BASE))
            .await?;
        let result = result.problems;

        let candidates: Vec<Candidate> = result
            .into_iter()
            .filter(|p| {
                p.rating
                    .is_some_and(|r| r >= self.min_rating && r <= self.max_rating)
            })
            .map(|p| Candidate {
                contest_id: p.contest_id,
                index: p.index.clone(),
                rating: p.rating.unwrap_or(0),
                url: format!(
                    "https://codeforces.com/contest/{}/problem/{}",
                    p.contest_id, p.index
                ),
            })
            .collect();

        *self.candidates_cache.lock().unwrap() = Some((std::time::Instant::now(), candidates.clone()));
        Ok(candidates)
    }

    pub async fn user_status(&self, handle: &str) -> anyhow::Result<Vec<CFSubmission>> {
        self.get(&format!(
            "{}user.status?handle={}&from=1&count=100",
            API_BASE,
            percent_encoding::utf8_percent_encode(handle, percent_encoding::NON_ALPHANUMERIC)
        ))
        .await
    }

    pub async fn standings(&self, contest_id: i64) -> anyhow::Result<StandingsResult> {
        self.get(&format!(
            "{}contest.standings?contestId={}&from=1&count=1",
            API_BASE, contest_id
        ))
        .await
    }

    pub async fn upcoming_contests(&self) -> anyhow::Result<Vec<Contest>> {
        let contests: Vec<Contest> = self.get(&format!("{}contest.list", API_BASE)).await?;
        Ok(contests
            .into_iter()
            .filter(|c| c.phase == "BEFORE")
            .collect())
    }
}

const API_BASE: &str = "https://codeforces.com/api/";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn problemset_response_shape_decodes() {
        let raw = r#"{
            "status": "OK",
            "result": {
                "problems": [
                    {
                        "contestId": 2257,
                        "index": "F2",
                        "name": "Beaver's Jumping Track (Hard Version)",
                        "type": "PROGRAMMING",
                        "rating": 1600,
                        "tags": ["dp"]
                    }
                ],
                "problemStatistics": [{ "contestId": 2257, "index": "F2", "solvedCount": 5 }]
            }
        }"#;
        let envelope: ApiEnvelope<ProblemsetResult> = serde_json::from_str(raw).unwrap();
        let result = envelope.result.unwrap();
        assert_eq!(result.problems.len(), 1);
        assert_eq!(result.problems[0].contest_id, 2257);
        assert_eq!(result.problems[0].index, "F2");
        assert_eq!(result.problems[0].rating, Some(1600));
    }

    #[test]
    fn user_status_shape_decodes_as_bare_array() {
        let raw = r#"{
            "status": "OK",
            "result": [
                {
                    "id": 123456789,
                    "verdict": "OK",
                    "problem": { "contestId": 1932, "index": "A" },
                    "creationTimeSeconds": 1787000000
                }
            ]
        }"#;
        let envelope: ApiEnvelope<Vec<CFSubmission>> = serde_json::from_str(raw).unwrap();
        let submissions = envelope.result.unwrap();
        assert_eq!(submissions.len(), 1);
        assert_eq!(submissions[0].verdict, "OK");
        assert_eq!(submissions[0].creation_time_seconds, 1787000000);
    }
}

use regex::Regex;

use super::{Context, Error};
use crate::data::StreakEntry;
use crate::streaks::{is_expired, yesterday_of};

pub struct ParsedLink {
    pub contest_id: i64,
    pub index: String,
}

pub fn parse_problem_link(link: &str) -> Option<ParsedLink> {
    let re = Regex::new(r"codeforces\.com/(?:contest|problemset|gym)/(\d+)/problem/([A-Za-z0-9]+)")
        .expect("valid regex");
    let captures = re.captures(link)?;
    Some(ParsedLink {
        contest_id: captures.get(1)?.as_str().parse().ok()?,
        index: captures.get(2)?.as_str().to_string(),
    })
}

/// Mark today's daily problem as done
#[poise::command(slash_command, guild_only)]
pub async fn done(
    ctx: Context<'_>,
    #[description = "Your Codeforces problem link"] link: String,
) -> Result<(), Error> {
    let parsed = parse_problem_link(&link);
    let Some(parsed) = parsed else {
        ctx.send(
            poise::CreateReply::default()
                .content(
                    "That doesn't look like a valid Codeforces problem link (e.g. https://codeforces.com/contest/1932/problem/A)",
                )
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    let store = &ctx.data().config.store;

    let Some(daily) = store.daily().filter(|d| !is_expired(d)) else {
        ctx.say("There's no active daily problem right now. The next one is posted at 1 PM Budapest.")
            .await?;
        return Ok(());
    };

    if parsed.contest_id != daily.contest_id
        || parsed.index.to_uppercase() != daily.index.to_uppercase()
    {
        ctx.say(format!(
            "That's not the current problem. Current problem: {}",
            daily.url
        ))
        .await?;
        return Ok(());
    }

    let handles = store.handles();
    let user_id = ctx.author().id.to_string();
    let Some(handle) = handles.get(&user_id) else {
        ctx.say("Link your Codeforces handle first: `/link <handle>`")
            .await?;
        return Ok(());
    };

    let mut streaks = store.streaks();
    let entry = streaks
        .get(&user_id)
        .cloned()
        .unwrap_or(StreakEntry::default());
    if entry.last_completed.as_deref() == Some(daily.date.as_str()) {
        ctx.say(format!(
            "You already completed this problem. Streak stays at {}.",
            entry.streak
        ))
        .await?;
        return Ok(());
    }

    ctx.defer().await?;

    let submissions = match store.codeforces.user_status(handle).await {
        Ok(submissions) => submissions,
        Err(error) => {
            let message = if error.downcast_ref::<reqwest::Error>().is_some() {
                "An error occurred while checking your submissions on Codeforces.".to_string()
            } else {
                format!(
                    "Could not fetch submissions for handle `{handle}`. Is it spelled correctly?"
                )
            };
            ctx.say(message).await?;
            return Ok(());
        }
    };

    let posted_at_seconds = daily.posted_at / 1000;
    let accepted = submissions.iter().find(|s| {
        s.verdict == "OK"
            && s.problem.as_ref().is_some_and(|p| {
                p.contest_id == daily.contest_id
                    && p.index.to_uppercase() == daily.index.to_uppercase()
            })
            && s.creation_time_seconds >= posted_at_seconds
    });

    let Some(_accepted) = accepted else {
        ctx.say("No accepted submission for this problem found. Make sure you solved it on Codeforces and that it was accepted after the problem was posted.")
            .await?;
        return Ok(());
    };

    let streak = if entry.last_completed.as_deref() == yesterday_of(&daily.date).as_deref() {
        entry.streak + 1
    } else {
        1
    };
    streaks.insert(
        user_id,
        StreakEntry {
            streak,
            last_completed: Some(daily.date.clone()),
        },
    );
    store.save_streaks(&streaks)?;

    let days = if streak == 1 { "" } else { "s" };
    ctx.say(format!("Nice! Your streak is now {streak} day{days}."))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_problem_link;

    #[test]
    fn parses_contest_and_gym_links() {
        let contest = parse_problem_link("https://codeforces.com/contest/1932/problem/A").unwrap();
        assert_eq!(contest.contest_id, 1932);
        assert_eq!(contest.index, "A");

        let gym = parse_problem_link("https://codeforces.com/gym/105505/problem/F2").unwrap();
        assert_eq!(gym.contest_id, 105505);
        assert_eq!(gym.index, "F2");

        // Same limitation as the TS regex: problemset URLs don't match.
        assert!(parse_problem_link("https://codeforces.com/problemset/problem/1932/A").is_none());
    }

    #[test]
    fn parses_with_surrounding_text() {
        let parsed = parse_problem_link("solve https://codeforces.com/contest/1932/problem/A now!")
            .unwrap();
        assert_eq!(parsed.index, "A");
    }

    #[test]
    fn rejects_invalid_links() {
        assert!(parse_problem_link("not a link").is_none());
        assert!(parse_problem_link("https://codeforces.com/contest/abc/problem/A").is_none());
        assert!(parse_problem_link("https://codeforces.com/contest/1932/").is_none());
        assert!(parse_problem_link("https://example.com/contest/1932/problem/A").is_none());
    }
}

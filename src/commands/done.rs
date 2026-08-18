use super::{Context, Error};
use crate::data::StreakEntry;
use crate::streaks::{is_expired, yesterday_of};

/// Mark today's daily problem as done
#[poise::command(slash_command, guild_only)]
pub async fn done(ctx: Context<'_>) -> Result<(), Error> {
    let store = &ctx.data().config.store;

    let Some(daily) = store.daily().filter(|d| !is_expired(d)) else {
        ctx.say("There's no active daily problem right now. The next one is posted at 1 PM Budapest.")
            .await?;
        return Ok(());
    };

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

    let Some(accepted) = accepted else {
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
    let name = ctx
        .author_member()
        .await
        .map(|m| m.display_name().to_string())
        .unwrap_or_else(|| ctx.author().name.clone());
    ctx.say(format!(
        "🥳 Congratulations {name}! You solved today's problem!\nSubmission: https://codeforces.com/contest/{}/submission/{}\nYour streak is now {streak} day{days}!",
        daily.contest_id, accepted.id
    ))
    .await?;
    Ok(())
}

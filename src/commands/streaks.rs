use super::{Context, Error};

/// Show the streak leaderboard
#[poise::command(slash_command, guild_only)]
pub async fn streaks(ctx: Context<'_>) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let streaks = ctx.data().config.store.streaks();
    let mut entries: Vec<(String, u32)> = streaks
        .iter()
        .filter(|(_, v)| v.streak > 0)
        .map(|(id, v)| (id.clone(), v.streak))
        .collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    if entries.is_empty() {
        ctx.say("No streaks yet. Solve today's problem and run `/done <link>` to start one!")
            .await?;
        return Ok(());
    }

    let mut lines = Vec::new();
    for (id, streak) in entries.into_iter().take(10) {
        let name = guild_id
            .member(ctx.http(), serenity::all::UserId::new(
                id.parse().unwrap_or_default(),
            ))
            .await
            .map(|member| member.display_name().to_string())
            .unwrap_or_else(|_| id.clone());
        let days = if streak == 1 { "" } else { "s" };
        lines.push(format!(
            "{}. **{name}** - {streak} day{days}",
            lines.len() + 1
        ));
    }

    ctx.say(format!("**Streak leaderboard**\n{}", lines.join("\n")))
        .await?;
    Ok(())
}

use super::{is_mod, Context, Error};
use crate::streaks::post_daily_problem;

/// Reroll today's daily problem (mods only)
#[poise::command(slash_command, guild_only)]
pub async fn new(ctx: Context<'_>) -> Result<(), Error> {
    if !is_mod(ctx).await {
        ctx.send(poise::CreateReply::default()
            .content("Only mods can reroll the daily problem.")
            .ephemeral(true))
            .await?;
        return Ok(());
    }

    ctx.defer().await?;

    let data = ctx.data();
    let channel_id = data.config.streaks_problem_channel;

    match post_daily_problem(&data.config.store, channel_id, ctx.http(), true).await
    {
        Ok(Some(message)) => {
            ctx.say(format!("Rerolled today's problem: {}", message.link()))
                .await?;
        }
        Ok(None) => {
            ctx.say("No daily problem has been posted yet today.")
                .await?;
        }
        Err(error) => {
            tracing::error!("Error rerolling daily problem: {error}");
            ctx.say("An error occurred while rerolling the daily problem.")
                .await?;
        }
    }
    Ok(())
}

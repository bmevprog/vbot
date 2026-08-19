use super::{is_mod, Context, Error};
use crate::config::persist_rating_range;

/// Set the bot's problem rating range (mods only)
#[poise::command(slash_command, guild_only)]
pub async fn setrating(
    ctx: Context<'_>,
    #[description = "Minimum problem rating"] min_rating: i64,
    #[description = "Maximum problem rating"] max_rating: i64,
) -> Result<(), Error> {
    if !is_mod(ctx).await {
        ctx.send(
            poise::CreateReply::default()
                .content("Only mods can change the rating range.")
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    }

    if min_rating >= max_rating {
        ctx.say("min_rating must be lower than max_rating.").await?;
        return Ok(());
    }
    if !(800..=3500).contains(&min_rating) || !(800..=3500).contains(&max_rating) {
        ctx.say("Ratings must be within 800..3500.").await?;
        return Ok(());
    }

    ctx.data().config.set_rating_range(min_rating, max_rating);

    match persist_rating_range(min_rating, max_rating) {
        Ok(()) => {
            ctx.say(format!("Rating range set to {min_rating}..{max_rating}."))
                .await?;
        }
        Err(error) => {
            tracing::error!("Failed to persist rating range: {error}");
            ctx.say("Rating range updated in memory, but could not write the .env file.")
                .await?;
        }
    }
    Ok(())
}

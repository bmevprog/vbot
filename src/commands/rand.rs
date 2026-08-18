use rand::RngExt;
use serenity::all::{Colour, CreateEmbed, CreateMessage};

use super::{Context, Error};

/// Get a random problem in the configured rating range
#[poise::command(slash_command, guild_only)]
pub async fn rand(ctx: Context<'_>) -> Result<(), Error> {
    ctx.defer().await?;

    let data = ctx.data();
    let min_rating = data.config.get_min_rating();
    let max_rating = data.config.get_max_rating();

    let candidates = match data
        .config
        .store
        .codeforces
        .problemset(min_rating, max_rating)
        .await
    {
        Ok(candidates) => candidates,
        Err(error) => {
            tracing::error!("Error fetching problemset: {error}");
            ctx.say("An error occurred while fetching problems.").await?;
            return Ok(());
        }
    };

    if candidates.is_empty() {
        ctx.say(format!(
            "No problems found in rating range {min_rating}..{max_rating}."
        ))
        .await?;
        return Ok(());
    }

    let picked = candidates[rand::rng().random_range(0..candidates.len())].clone();

    let embed = CreateEmbed::new()
        .color(Colour::new(0x2ecc71))
        .title("Random Problem")
        .description(&picked.url)
        .field("Rating", picked.rating.to_string(), true);

    ctx.channel_id()
        .send_message(ctx.http(), CreateMessage::new().embed(embed))
        .await?;
    Ok(())
}

use super::{Context, Error};

/// Link your Codeforces handle to your Discord account
#[poise::command(slash_command, guild_only)]
pub async fn link(
    ctx: Context<'_>,
    #[description = "Your Codeforces handle"] handle: String,
) -> Result<(), Error> {
    let handle = handle.trim().to_string();
    if handle.is_empty() {
        ctx.send(poise::CreateReply::default()
            .content("Please provide your Codeforces handle.")
            .ephemeral(true))
            .await?;
        return Ok(());
    }

    let store = &ctx.data().config.store;
    let mut handles = store.handles();
    handles.insert(ctx.author().id.to_string(), handle.clone());
    store.save_handles(&handles)?;
    ctx.say(format!("Linked Codeforces handle `{handle}` to your account."))
        .await?;
    Ok(())
}

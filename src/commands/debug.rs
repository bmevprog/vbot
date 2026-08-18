use chrono::Utc;

use super::{is_mod, Context, Error};
use crate::streaks::{TZ, is_expired};

/// Show bot diagnostics (mods only)
#[poise::command(slash_command, guild_only)]
pub async fn debug(ctx: Context<'_>) -> Result<(), Error> {
    if !is_mod(ctx).await {
        ctx.send(
            poise::CreateReply::default()
                .content("Only mods can run this.")
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    }

    ctx.defer_ephemeral().await?;

    let data = ctx.data();
    let config = &data.config;

    let uptime = data.started_at.elapsed();
    let uptime_h = uptime.as_secs() / 3600;
    let uptime_m = (uptime.as_secs() % 3600) / 60;

    let now = Utc::now();
    let now_bud = now.with_timezone(&TZ);

    let daily = config.store.daily();
    let handles = config.store.handles();
    let streaks = config.store.streaks();
    let active_streaks = streaks.values().filter(|s| s.streak > 0).count();
    let past = config.store.past_problems();

    let cache_age = config
        .store
        .codeforces
        .candidates_cache_age()
        .map(|age| format!("{}s old", age.as_secs()))
        .unwrap_or_else(|| "empty".into());

    let upcoming = match config.store.codeforces.upcoming_contests().await {
        Ok(contests) => contests.len().to_string(),
        Err(error) => format!("error: {error}"),
    };

    let daily_line = match &daily {
        Some(d) => format!(
            "date {} | expired: {} | {}",
            d.date,
            is_expired(d),
            d.url
        ),
        None => "none".to_string(),
    };

    let token = config
        .discord_token
        .chars()
        .enumerate()
        .map(|(i, c)| if i >= 4 && i < config.discord_token.len().saturating_sub(4) { '*' } else { c })
        .collect::<String>();

    let message = format!(
        "vbot debug\n\
         Version: {version}   Uptime: {uptime_h}h {uptime_m}m\n\
         Guild: {guild}\n\
         Now UTC / Budapest: {now} / {now_bud}\n\
         \n\
         Config\n\
         BOT_CHANNEL: {bot}\n\
         CODEFORCES_CHANNEL: {cf_channel}\n\
         CODEFORCES_ROLE: {cf_role}\n\
         STREAKS_PROBLEM_CHANNEL: {streaks_channel}\n\
         STREAKS_ADMIN_ROLE: {admin_role}\n\
         DATA_DIR: {data_dir}\n\
         ratings: {min_rating}..{max_rating}\n\
         UPCOMING_FREQ: {freq} ms\n\
         UPCOMING_DELTA: {delta} ms\n\
         DAILY_NOTIF: {hour}:{min:02}\n\
         DAILY_NOTIF_DELTA: {daily_delta} ms\n\
         DISCORD_TOKEN: {token}\n\
         \n\
         Data\n\
         daily.json: {daily_line}\n\
         handles.json: {handles}\n\
         streaks.json: {streaks_count} ({active_streaks} active)\n\
         past_problems.json: {past}\n\
         candidates cache: {cache_age}\n\
         upcoming contests: {upcoming}",
        version = env!("CARGO_PKG_VERSION"),
        uptime_h = uptime_h,
        uptime_m = uptime_m,
        guild = config.discord_server,
        now = now.format("%H:%M:%S"),
        now_bud = now_bud.format("%H:%M:%S"),
        bot = config.bot_channel,
        cf_channel = config.codeforces_channel,
        cf_role = config.codeforces_role,
        streaks_channel = config.streaks_problem_channel,
        admin_role = config.streaks_admin_role,
        data_dir = config.store.dir.display(),
        min_rating = config.store.codeforces.min_rating,
        max_rating = config.store.codeforces.max_rating,
        freq = config.upcoming_freq.as_millis(),
        delta = config.upcoming_delta.as_millis(),
        hour = config.daily_notif_hour,
        min = config.daily_notif_min,
        daily_delta = config.daily_notif_delta.as_millis(),
        token = token,
        daily_line = daily_line,
        handles = handles.len(),
        streaks_count = streaks.len(),
        active_streaks = active_streaks,
        past = past.len(),
        cache_age = cache_age,
        upcoming = upcoming,
    );

    ctx.send(poise::CreateReply::default().content(message).ephemeral(true))
        .await?;
    Ok(())
}

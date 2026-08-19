use chrono::{Timelike, Utc};
use serenity::all::Http;
use std::sync::Arc;

use crate::commands::Data;
use crate::streaks::{POST_HOUR, TZ, next_post_at, post_daily_problem};

pub async fn run_scheduler(data: Arc<Data>) {
    let http = Http::new(&data.config.discord_token);
    let channel_id = data.config.streaks_problem_channel;

    catch_up(&data, &http).await;

    loop {
        let now = Utc::now();
        let next = next_post_at(now);
        let duration = (next - now).to_std().unwrap_or_default();
        tokio::time::sleep(duration).await;

        if let Err(error) = post_daily_problem(
            &data.config.store,
            data.config.get_min_rating(),
            data.config.get_max_rating(),
            channel_id,
            &http,
            false,
        )
        .await
        {
            tracing::error!("Daily problem posting failed: {error}");
        }
    }
}

async fn catch_up(data: &Arc<Data>, http: &Http) {
    let hour = Utc::now().with_timezone(&TZ).hour();
    if hour >= POST_HOUR {
        if let Err(error) = post_daily_problem(
            &data.config.store,
            data.config.get_min_rating(),
            data.config.get_max_rating(),
            data.config.streaks_problem_channel,
            http,
            false,
        )
        .await
        {
            tracing::error!("Daily problem catch-up failed: {error}");
        }
    }
}

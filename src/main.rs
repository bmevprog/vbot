mod codeforces;
mod commands;
mod config;
mod data;
mod reminders;
mod scheduler;
mod streaks;

use std::sync::Arc;

use commands::Data;
use poise::serenity_prelude as serenity;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = match config::Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!("{error}");
            std::process::exit(1);
        }
    };

    let data = Arc::new(Data {
        config,
        started_at: std::time::Instant::now(),
    });

    let data_for_framework = data.clone();
    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: vec![
                commands::link::link(),
                commands::done::done(),
                commands::new::new(),
                commands::streaks::streaks(),
                commands::cf::cf(),
                commands::debug::debug(),
                commands::rand::rand(),
                commands::setrating::setrating(),
            ],
            ..Default::default()
        })
        .setup(move |ctx, _ready, framework| {
            let data = data_for_framework.clone();
            Box::pin(async move {
                poise::builtins::register_in_guild(
                    ctx,
                    &framework.options().commands,
                    serenity::GuildId::new(data.config.discord_server),
                )
                .await?;
                tokio::spawn(scheduler::run_scheduler(data.clone()));
                tokio::spawn(reminders::run_reminders(data.clone()));
                Ok((*data).clone())
            })
        })
        .build();

    let mut client = serenity::Client::builder(
        data.config.discord_token.clone(),
        serenity::GatewayIntents::non_privileged(),
    )
    .framework(framework)
    .await
    .expect("Failed to create the Discord client");

    if let Err(error) = client.start().await {
        tracing::error!("Bot failed: {error}");
        std::process::exit(1);
    }
}

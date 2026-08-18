pub mod cf;
pub mod debug;
pub mod done;
pub mod link;
pub mod new;
pub mod streaks;

use crate::config::Config;

#[derive(Clone)]
pub struct Data {
    pub config: Config,
    pub started_at: std::time::Instant,
}

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Context<'a> = poise::Context<'a, Data, Error>;

pub async fn is_mod(ctx: Context<'_>) -> bool {
    let Some(member) = ctx.author_member().await else {
        return false;
    };
    let Some(guild_id) = ctx.guild_id() else {
        return false;
    };

    let admin_role = &ctx.data().config.streaks_admin_role;
    let Ok(roles) = guild_id.roles(ctx.http()).await else {
        return false;
    };
    member.roles.iter().any(|role_id| {
        roles
            .get(role_id)
            .is_some_and(|role| role.name.eq_ignore_ascii_case(admin_role))
    })
}

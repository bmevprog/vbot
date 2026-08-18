use std::collections::HashMap;

use serenity::all::{ChannelType, Colour, CreateEmbed, CreateForumPost, CreateMessage};

use super::{Context, Error};

struct Subproblem {
    name: String,
    index: String,
}

/// Post all threads for a Codeforces contest
#[poise::command(slash_command, guild_only)]
pub async fn cf(
    ctx: Context<'_>,
    #[description = "The ID of the Codeforces contest"] contest: i64,
    #[description = "The name of the forum channel to post in"] forum: String,
) -> Result<(), Error> {
    ctx.defer().await?;

    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let standings = match ctx.data().config.store.codeforces.standings(contest).await {
        Ok(standings) => standings,
        Err(_) => {
            ctx.say("Failed to retrieve contest data.").await?;
            return Ok(());
        }
    };

    let mut problem_map: HashMap<String, (String, Vec<Subproblem>)> = HashMap::new();
    for problem in &standings.problems {
        let base_index: String = problem
            .index
            .chars()
            .filter(|c| !c.is_ascii_digit())
            .collect();
        let base_name = problem
            .name
            .split('(')
            .next()
            .unwrap_or(&problem.name)
            .trim()
            .to_string();
        let sub_name = problem
            .name
            .split('(')
            .nth(1)
            .and_then(|s| s.split(')').next())
            .map(|s| s.to_string())
            .unwrap_or_else(|| base_name.clone());

        problem_map
            .entry(base_index)
            .or_insert_with(|| (base_name, Vec::new()))
            .1
            .push(Subproblem {
                name: sub_name,
                index: problem.index.clone(),
            });
    }

    let channels = guild_id.channels(ctx.http()).await?;
    let forum_channel = channels
        .values()
        .find(|c| c.name == forum && c.kind == ChannelType::Forum);

    let Some(forum_channel) = forum_channel else {
        ctx.say(format!("Forum channel \"{forum}\" not found."))
            .await?;
        return Ok(());
    };

    let todo_id = forum_channel
        .available_tags
        .iter()
        .find(|tag| tag.name == "Todo")
        .map(|tag| tag.id);

    let mut threads = Vec::new();
    for (base_index, (base_name, subproblems)) in &problem_map {
        let mut embed = CreateEmbed::new()
            .color(Colour::new(0x222222))
            .title(base_name)
            .footer(serenity::all::CreateEmbedFooter::new(&standings.contest.name));

        if subproblems.len() > 1 {
            let fields: Vec<(String, String, bool)> = subproblems
                .iter()
                .map(|s| {
                    (
                        s.name.clone(),
                        format!(
                            "https://codeforces.com/contest/{}/problem/{}",
                            standings.contest.id, s.index
                        ),
                        false,
                    )
                })
                .collect();
            embed = embed.fields(fields);
        } else if let Some(first) = subproblems.first() {
            embed = embed.description(format!(
                "https://codeforces.com/contest/{}/problem/{}",
                standings.contest.id, first.index
            ));
        }

        let message = CreateMessage::new()
            .content("Send your code and discuss in the comments! :)")
            .embeds(vec![embed]);

        let mut post = CreateForumPost::new(
            format!(
                "CF {}{} - {}",
                standings.contest.id, base_index, base_name
            ),
            message,
        )
        .auto_archive_duration(serenity::all::AutoArchiveDuration::OneDay);
        if let Some(tag_id) = todo_id {
            post = post.add_applied_tag(tag_id);
        }

        let thread = forum_channel.id.create_forum_post(ctx.http(), post).await?;
        threads.push(format!(
            "https://discord.com/channels/{}/{}",
            guild_id, thread.id
        ));
    }

    let reply = format!(
        "Threads for {}:\n{}",
        standings.contest.name,
        threads.join("\n")
    );
    ctx.say(reply).await?;
    Ok(())
}

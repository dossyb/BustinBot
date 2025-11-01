import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, EmbedBuilder } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { packageVersion } from "../../../utils/version.js";

const moviehelp: Command = {
    name: 'moviehelp',
    description: "Learn how movie nights work and what commands can be used.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("moviehelp")
        .setDescription("Learn how movie nights work and what commands can be used."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: any }) {
        if (!interaction) return;

        const guildConfig = await services.guilds.requireConfig(interaction);
        const guild = interaction.guild!;
        const member = interaction.member as GuildMember;

        const guildRoles = guildConfig.roles ?? {};
        const userRoleIds = member.roles.cache.map((r) => r.id);

        const isBotAdmin = guildRoles.admin && userRoleIds.includes(guildRoles.admin);
        const isMovieAdmin = guildRoles.movieAdmin && userRoleIds.includes(guildRoles.movieAdmin);
        const isPrivilegedUser =
            guild.ownerId === interaction.user.id ||
            member.permissions.has("Administrator") ||
            isBotAdmin || isMovieAdmin;

        const generalDescription = "BustinBot's **movie night system** helps the community host and vote on regular movie watch parties! Movies are added by users, selected by admins, random, or community polls, and watched together in the movie voice channel.";

        const userCommands = [
            { name: "/addmovie", value: "Add a movie to the community watchlist (up to 3 active movies per user)." },
            { name: "/listmovies", value: "View the current unwatched movie list including who added each." },
            { name: "/viewmovie", value: "View details for a specific movie in the list." },
            { name: "/currentmovie", value: "View details about an upcoming movie night."},
            { name: "/removemovie", value: "Remove a movie you have added to the watchlist."},
            { name: "/mymovies", value: "View all movies you have added to the watchlist."},
        ];

        const adminCommands = [
            { name: "/moviesetup", value: "Configure movie-related channels and roles for the server."},
            { name: "/pickmovie", value: "Choose the next movie to watch by search, random roll or a community poll." },
            { name: "/movienight", value: "Schedule and announce the next movie night."},
            { name: "/cancelmovie", value: "Cancels a scheduled movie night and deselects the picked movie."},
            { name: "/endmovie", value: "Manual override to finish a movie night (this should be automatic)."},
            { name: "/closemoviepoll", value: "Manual override to end a movie poll early."}            
        ];

        const fields = [
            {
                name: "🎞️ How It Works",
                value: "Users can add up to 3 movies at a time to the community's watchlist. When a movie night is planned, admins will pick a movie from the list either directly, via a random roll or via a community poll of up to 5 movies from the list. Admins will schedule a date and time for the movie night in a public post and reminder notifications are automatically sent at 2 hours and at 30 mins before the start time. Once the movie ends, the bot marks it as watched and hides it from the watchlist, allowing the user who suggested it to add another movie in its place."
            }
        ];

        const visibleCommands = isPrivilegedUser ? [...userCommands, ...adminCommands] : userCommands;

        const commandList = visibleCommands
            .map((cmd) => `**${cmd.name}** - ${cmd.value}`)
            .join("\n");

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🎥 Movie Night Guide")
            .setDescription(generalDescription)
            .addFields(fields)
            .addFields({
                name: isPrivilegedUser ? "Available Commands (User + Admin)" : "Available Commands",
                value: commandList,
            })
            .setFooter({
                text: `BustinBot ${packageVersion} • Developed by dossyb`
            });

        await interaction.reply({ embeds: [embed], flags: 1 << 6 });
    }
};

export default moviehelp;

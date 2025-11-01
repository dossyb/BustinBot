import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import type { Command } from "models/Command";
import { CommandModule, CommandRole } from "models/Command";
import { version } from "../../../../package.json";
import { replaceBustinEmote } from "utils/EmoteHelper";

const help: Command = {
    name: "help",
    description: "Learn what BustinBot does and how to get started.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Learn what BustinBot does and how to get started."),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const guild = interaction.guild ?? null;
        const emoji = replaceBustinEmote("🤖", guild);
        const title = `${emoji} Welcome to BustinBot`;
        
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(title)
            .setDescription(
                "BustinBot is a custom community Discord bot that helps manage **movie nights**, **OSRS community tasks** and a bit of personality through fun interactions."
            )
            .addFields(
                {
                    name: "🎥 Movie Nights",
                    value: "Host and vote on regular movie nights with your community. Users can add movies to the watchlist and participate in polls to choose what to watch next.\nRun `/moviehelp` to learn more."
                },
                {
                    name: "🗺️ OSRS Community Tasks",
                    value: "Compete in weekly Old School RuneScape tasks for prizes and bragging rights. Earn rolls in the fortnightly prize draw by completing Bronze, Silver, or Gold tiers on each task.\nRun `/taskhelp` to learn more.",
                },
                {
                    name: "⚙️ Core Commands",
                    value: [
                        "**/bustin** — Say hello to BustinBot.",
                        "**/goodbot** — Praise BustinBot.",
                        "**/badbot** — Criticise BustinBot.",
                        "**/botinfo** — See version info, uptime, and attributions.",
                        "**/stats** — View your BustinBot stats for this server.",
                        "**/support** — Learn how to contribute to BustinBot.",
                    ].join("\n"),
                }
            )
            .setFooter({
                text: `BustinBot ${version ?? "v2"} • Developed by dossyb`,
            });

        await interaction.reply({ embeds: [embed], flags: 1 << 6 });
    }
};

export default help;
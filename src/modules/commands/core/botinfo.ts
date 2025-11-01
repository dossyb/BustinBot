import { SlashCommandBuilder, ChatInputCommandInteraction, Message, EmbedBuilder } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { replaceBustinEmote } from "../../../utils/EmoteHelper.js";
import { packageVersion } from "../../../utils/version.js";

const START_TIME = Date.now();

function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000) % 60;
    const days = Math.floor(ms / 1000 / 86400);
    const hours = Math.floor((ms / 1000 % 86400) / 3600);
    const minutes = Math.floor((ms / 1000 % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

const botinfo: Command = {
    name: 'botinfo',
    description: 'Display information about BustinBot, including version, uptime, and credits.',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Display information about BustinBot, including version, uptime, and credits.'),

    async execute({ interaction, message }: { interaction?: ChatInputCommandInteraction, message?: Message }) {
        const uptime = formatUptime(Date.now() - START_TIME);
        const ping = interaction?.client.ws.ping ?? 'N/A';

        const guild = interaction?.guild ?? null;
        const emoji = replaceBustinEmote("🤖", guild);
        const title = `${emoji} BustinBot Information`;
    
        const embed = new EmbedBuilder()
            .setColor(0x00c6ff)
            .setTitle(title)
            .setDescription(
                "A custom-built Discord bot designed for community OSRS events and movie nights."
            )
            .addFields(
                { name: "Version", value: packageVersion, inline: true },
                { name: "Uptime", value: uptime, inline: true },
                { name: "Ping", value: `${ping} ms`, inline: true },
                {
                    name: "Attribution",
                    value:
                        "🎥 **Movie Metadata:** [TMDb](https://www.themoviedb.org/) (The Movie Datbase)\n" +
                        "🖼️ **Icons**: [Freepik](https://www.freepik.com/)",
                },
                {
                    name: "Developer",
                    value: "Developed by **dossyb** (2025)\nBuilt using Discord.js, TypeScript, and Firestore.",
                }
            )
            .setTimestamp();

        if (interaction) {
            await interaction.reply({ embeds: [embed], flags: 64 });
        } else if (message) {
            await message.reply({ embeds: [embed] });
        }
    }
};

export default botinfo;

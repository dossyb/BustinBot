import { SlashCommandBuilder, ChatInputCommandInteraction, Message } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandModule, CommandRole } from "../../../models/Command";
import { version as botVersion } from '../../../../package.json';

const BOT_TIMEZONE = process.env.BOT_TIMEZONE || 'UTC';
const START_TIME = Date.now();

function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000) % 60;
    const days = Math.floor(ms / 1000 / 86400);
    const hours = Math.floor((ms / 1000 % 86400) / 3600);
    const minutes = Math.floor((ms / 1000 % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

const botstatus: Command = {
    name: 'botstatus',
    description: 'Display bot version, timezone, uptime, and more.',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Display bot version, timezone, uptime, and more.'),

    async execute({ interaction, message }: { interaction?: ChatInputCommandInteraction, message?: Message }) {
        const uptime = formatUptime(Date.now() - START_TIME);
        const ping = interaction?.client.ws.ping ?? 'N/A';
    
        const embed = {
            color: 0x00c6ff,
            title: 'BustinBot Status',
            fields: [
                { name: 'Version', value: botVersion, inline: true },
                { name: 'Timezone', value: BOT_TIMEZONE, inline: true },
                { name: 'Uptime', value: uptime, inline: true },
                { name: 'Ping', value: `${ping} ms`, inline: true },
            ],
            timestamp: new Date().toISOString(),
        };

        if (interaction) {
            await interaction.reply({ embeds: [embed], flags: 64 });
        } else if (message) {
            await message.reply({ embeds: [embed] });
        }
    }
};

export default botstatus;
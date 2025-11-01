import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import { packageVersion } from '../../../utils/version.js';

const support: Command = {
    name: 'support',
    description: 'Learn how to support BustinBot and its development!',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('support')
        .setDescription('Get links to support the bot, contribute, or donate.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const embed = {
            color: 0x5865f2,
            title: "❤️ Support BustinBot",
            description: "Thank you for your interest in supporting BustinBot! Here are a few ways you can help out:",
            fields: [
                {
                    name: "🛠️ Contribute to the Project",
                    value: "[GitHub Repo](https://github.com/dossyb/BustinBot) - Report issues, suggest features, or submit pull requests for your own modules/features"
                },
                {
                    name: "☕ Buy Me a Coffee",
                    value: "[Ko-fi Donation Page](https://ko-fi.com/dossyb) - Show your appreciation by contributing to the server/API costs and the dev's coffee addiction"
                },
                {
                    name: "ℹ️ More Info",
                    value: "BustinBot is lovingly maintained by an Aussie dev as a passion project."
                }
            ],
            footer: {
                text: `BustinBot ${packageVersion} • Developed by dossyb`
            }
        };

        await interaction.reply({ embeds: [embed], flags: 1 << 6});
    },
};

export default support;

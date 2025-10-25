import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from '../../../models/Command';

const movienight: Command = {
    name: 'movienight',
    description: "Schedule the next movie night.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('movienight')
        .setDescription('Schedule the next movie night.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const today = new Date();
        const options = Array.from({ length: 14 }, (_, i) => {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            return {
                label: date.toLocaleDateString('en-AU', { weekday: 'short', month: 'short', day: 'numeric' }),
                value: date.toISOString().split("T")[0] as string,
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('movienight-select-date')
            .setPlaceholder('Select a date for movie night...')
            .addOptions(options);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.reply({
            content: '📆 Choose a date for the next movie night:',
            components: [row],
            flags: 1 << 6
        });
    }
};

export default movienight;

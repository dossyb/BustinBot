import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { resolveGuildTimezone } from "../../movies/MovieScheduler.js";

const movienight: Command = {
    name: "movienight",
    description: "Schedule the next movie night.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("movienight")
        .setDescription("Schedule the next movie night."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        const today = DateTime.now().setZone(await resolveGuildTimezone(services)).startOf("day");
        const options = Array.from({ length: 14 }, (_, i) => {
            const date = today.plus({ days: i });
            return {
                label: date.toLocaleString({ weekday: "short", month: "short", day: "numeric" }, { locale: "en-AU" }),
                value: date.toFormat("yyyy-MM-dd"),
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("movienight-select-date")
            .setPlaceholder("Select a date for movie night...")
            .addOptions(options);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.reply({
            content: "📆 Choose a date for the next movie night:",
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};

export default movienight;

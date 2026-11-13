import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { buildTaskInfoEmbed } from "../../tasks/TaskEmbeds.js";

const viewtask: Command = {
    name: "viewtask",
    description: "View details for a specific task by ID or name.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("viewtask")
        .setDescription("View details for a specific task by ID or name.")
        .addStringOption((option) =>
            option
                .setName("search")
                .setDescription("Task ID or task name.")
                .setRequired(true)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const query = interaction.options.getString("search", true);
        const tasks = await services.tasks.getAllTasks();
        if (!tasks.length) {
            await interaction.editReply("No tasks were found in the database.");
            return;
        }

        const search = query.trim();
        const [bestMatch] = search ? await services.tasks.searchTasks(search, 1) : [];
        if (!bestMatch) {
            await interaction.editReply(`No task found matching \`${query}\`.`);
            return;
        }

        const embedData = buildTaskInfoEmbed(bestMatch);
        await interaction.editReply({
            embeds: embedData.embeds,
            files: embedData.files,
        });
    },
};

export default viewtask;

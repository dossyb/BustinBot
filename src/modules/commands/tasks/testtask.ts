import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { buildTaskEventEmbed } from "../../tasks/TaskEmbeds";
import type { TaskEvent } from "../../../models/TaskEvent";
import { TaskInstruction, TaskCategory, TaskType } from "../../../models/Task";

const testtask: Command = {
    name: 'testtask',
    description: 'Post a fake task event for testing the submission flow.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('testtask')
        .setDescription('Post a fake task event for testing.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        // Fake task event data
        const event: TaskEvent = {
            task: {
                id: 9999,
                taskName: "Catch {amount} Bustin Implings",
                amounts: [50, 100, 200],
                instruction: TaskInstruction.ScreenshotsRequired,
                category: TaskCategory.Minigame,
                type: TaskType.KC,
            },
            selectedAmount: 100,
            keyword: 'pineapple',
            startTime: new Date(),
            endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        }

        const channel = interaction.channel as TextChannel;
        const { embeds, components } = buildTaskEventEmbed(event);

        await channel.send({ embeds, components });
        await interaction.reply({ content: 'Test task event posted!', flags: 1 << 6 });
    },
};

export default testtask;
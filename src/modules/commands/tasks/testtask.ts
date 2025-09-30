import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { buildTaskEventEmbed } from "../../tasks/TaskEmbeds";
import type { TaskEvent } from "../../../models/TaskEvent";
import type { Task } from "../../../models/Task";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from "fs";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testtask: Command = {
    name: 'testtask',
    description: 'Post a fake task event for testing the submission flow.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('testtask')
        .setDescription('Post a fake task event for testing.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const filePath = path.join(__dirname, '../../../data/tasks.json');
        const taskData: Task[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (!taskData.length) {
            await interaction.reply({ content: "No tasks available.", flags: 1 << 6});
            return;
        }
        const randomTask = taskData[Math.floor(Math.random() * taskData.length)];
        if (!randomTask) {
            await interaction.reply({ content: 'Failed to retrieve a random task.', flags: 1 << 6});
            return;
        }
        const selectedAmount = randomTask.amounts?.length ? randomTask.amounts[Math.floor(Math.random() * randomTask?.amounts.length)] : undefined;

        // Fake task event data
        const baseEvent = {
            task: randomTask,
            keyword: 'pineapple',
            startTime: new Date(),
            endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        }

        const event: TaskEvent = selectedAmount !== undefined
        ? { ...baseEvent, selectedAmount }
        : baseEvent;

        const channel = interaction.channel as TextChannel;
        const { embeds, components } = buildTaskEventEmbed(event);

        await channel.send({ embeds, components });
        await interaction.reply({ content: 'Test task event posted!', flags: 1 << 6 });
    },
};

export default testtask;
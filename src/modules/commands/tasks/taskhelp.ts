import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { packageVersion } from '../../../utils/version.js';

const taskhelp: Command = {
    name: 'taskhelp',
    description: 'Learn how the OSRS community tasks work and how to participate.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('taskhelp')
        .setDescription('Learn how the OSRS community tasks work and how to participate.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const embed = {
            color: 0x5865f2,
            title: '🗺️ OSRS Community Task Guide',
            description:
                "BustinBot's **OSRS task system** lets the community compete in fun challenges for prizes and bragging rights! Here's everything you need to know:",
            fields: [
                {
                    name: "🗳️ Task Polls",
                    value:
                        "Every **Sunday at 00:00 UTC**, a poll is posted for each task category (PvM, Skiling, and Minigame/Misc). Each poll runs for **24 hours** and you can vote for only one task per poll using the buttons underneath, though you can change your vote at any time.\nThe winners of each poll become the tasks for the following event."
                },
                {
                    name: "📊 Task Events",
                    value:
                        "New tasks are posted every **Monday at 00:00 UTC**. Each task includes three tiers of completion corresponding to progressively higher requirements for completion:\n🥉 **Bronze (1 roll)** 🥈 **Silver (2 rolls)** 🥇 **Gold (3 rolls)**\nEach tier awards more prize rolls in the next draw - the higher the tier, the better your odds!"
                },
                {
                    name: "📷 Submitting Your Task",
                    value:
                        "To verify your completion for a task, click **Submit Screenshot** under its post and follow the prompts in your DMs (which must be turned on). Each task will have specific instructions in its post for how many screenshots to take and what level of verification is required (XP tracker, keyword etc.).\nYour submission will be reviewed by the task admin team and either approved for a specific tier or rejected. You may resubmit for a task following the same steps."
                },
                {
                    name: "🏆 Prize Draws",
                    value:
                        "Prize draws occur **every fortnight on Tuesday at 00:00 UTC**. Each prize roll counts as one entry so completing more tasks at higher tiers improve your odds of winning.\nWinners are announced in the task channel and will be contacted by a task admin to award them with a free bond!"
                },
            ],
            footer: {
                text: `BustinBot ${packageVersion} • Developed by dossyb`
            }
        };

        await interaction.reply({ embeds: [embed], flags: 1 << 6 });
    }
}

export default taskhelp;

import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { closeActiveMoviePoll } from "../../movies/MoviePolls.js";
import { createMoviePollClosedEmbed } from "../../movies/MovieEmbeds.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { configuredChannel } from "../../../utils/ChannelUtils.js";

const closemoviepoll: Command = {
    name: "closemoviepoll",
    description: "Manually close the active movie poll and announce the winner.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("closemoviepoll")
        .setDescription("Manually close the active movie poll and announce the winner."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await closeActiveMoviePoll(services, interaction.client, interaction.user.id);

        if (!result.success) {
            await interaction.editReply(`${result.message}`);
            return;
        }

        if (result.winner) {
            const channel = await configuredChannel(interaction.client, services, "movieNight");
            const embed = createMoviePollClosedEmbed(
                result.winner,
                interaction.user.username,
                result.winningVotes ?? 0,
                result.tieBreak ?? false
            );
            await channel?.send({ embeds: [embed] });
        }

        await interaction.editReply(`✅ Movie poll closed successfully.\n${result.message}`);
    }
}

export default closemoviepoll;

import type { Interaction } from "discord.js";
import type { Command } from "../../models/Command.js";
import type { ServiceContainer } from "../services/ServiceContainer.js";
import { handleInteraction } from "./onInteraction.js";
import { handleMovieInteraction } from "../../modules/movies/MovieInteractionHandler.js";
import { handleTaskInteraction } from "../../modules/tasks/TaskInteractionHandler.js";

export async function routeInteraction(
    interaction: Interaction,
    commands: Map<string, Command>,
    services: ServiceContainer,
): Promise<void> {
    await handleInteraction(interaction, commands, services);
    await handleMovieInteraction(interaction, services);
    await handleTaskInteraction(interaction, services);
}

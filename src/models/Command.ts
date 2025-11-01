import { ChatInputCommandInteraction, Message, SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder, type SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import type { ServiceContainer } from '../core/services/ServiceContainer.js';

export enum CommandRole {
    Everyone = 'Everyone',
    TaskAdmin = 'TaskAdmin',
    MovieAdmin = 'MovieAdmin',
    BotAdmin = 'BotAdmin'
}

export enum CommandModule {
    Core = 'core',
    Movie = 'movie',
    Task = 'task',
}

export interface Command {
    // Unique name of the command
    name: string;

    // Description of what the command does
    description: string;

    // Module the command belongs to
    module: CommandModule;

    // Optional list of aliases
    aliases?: string[];

    // Whether the command can only be used in guilds (not DMs)
    guildOnly?: boolean;

    // Usage string for help text (e.g. "/pollmovie <count>")
    usage?: string;

    // Example invocations
    examples?: string[];

    // List of roles allowed to use the command
    allowedRoles: CommandRole[];

    // Core execution logic
    // Support both message-based (prefix) and slash commands
    execute: (context: {
        message?: Message;
        interaction?: ChatInputCommandInteraction;
        args?: string[];
        services: ServiceContainer;
    }) => Promise<void>;

    // Optional method to return a SlashCommandBuilder for registering slash commands
    slashData?: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder
}
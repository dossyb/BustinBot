import { GuildMemberFlagsBitField, RoleFlagsBitField, SnowflakeUtil } from "discord.js";
import { pick } from "es-toolkit";
import {
    ApplicationCommandOptionType,
    ApplicationFlags,
    ApplicationCommandType,
    ChannelType,
    ComponentType,
    GatewayVersion,
    GuildDefaultMessageNotifications,
    GuildExplicitContentFilter,
    GuildMFALevel,
    GuildNSFWLevel,
    GuildPremiumTier,
    GuildSystemChannelFlags,
    GuildVerificationLevel,
    InteractionContextType,
    InteractionResponseType,
    InteractionType,
    Locale,
    MessageFlags,
    MessageType,
    RESTJSONErrorCodes,
    RouteBases,
    type APIApplicationCommandAutocompleteGuildInteraction,
    type APIApplicationCommandInteractionDataBasicOption,
    type APIApplicationCommandInteractionDataOption,
    type APIApplicationCommandInteractionDataSubcommandOption,
    type APIAttachment,
    type APIChatInputApplicationCommandGuildInteraction,
    type APIGuildMember,
    type APIGuildTextChannel,
    type APIGuildVoiceChannel,
    type APIVoiceState,
    type APIInteractionDataResolved,
    type APIInteractionDataResolvedChannel,
    type APIInteractionGuildMember,
    type APIMessage,
    type APIMessageButtonInteractionData,
    type APIMessageComponentButtonInteraction,
    type APIMessageComponentSelectMenuInteraction,
    type APIMessageSelectMenuInteractionData,
    type APIModalSubmitGuildInteraction,
    type APIRole,
    type APIUser,
    type GatewayGuildCreateDispatchData,
    type GatewayMessageCreateDispatchData,
    type APIDMChannel,
    type APIGatewayBotInfo,
    type GatewayReadyDispatchData,
} from "discord-api-types/v10";

export const IDS = {
    application: "100000000000000001",
    bot: "100000000000000002",
    guild: "100000000000000010",
    otherGuild: "100000000000000011",
    otherGuildChannel: "100000000000000021",
    uncachedGuild: "100000000000000012",
    channel: "100000000000000020",
    missingChannel: "100000000000000099",
    owner: "100000000000000029",
    dm: "100000000000000050",
    user: "100000000000000030",
    roles: {
        admin: "100000000000000041",
        taskAdmin: "100000000000000042",
        movieAdmin: "100000000000000043",
        taskUser: "100000000000000044",
    },
} as const;

export const NAMES = {
    guild: "Test Guild",
    channel: "general",
    username: "tester",
    displayName: "Tester",
    roles: { admin: "BustinBot Admin", taskAdmin: "Task Admin", movieAdmin: "Movie Admin", taskUser: "Task User" },
} as const;

export const DiscordError = {
    unknownChannel: { status: 404, body: { code: RESTJSONErrorCodes.UnknownChannel, message: "Unknown Channel" } },
    unknownMessage: { status: 404, body: { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" } },
    missingAccess: { status: 403, body: { code: RESTJSONErrorCodes.MissingAccess, message: "Missing Access" } },
    missingPermissions: {
        status: 403,
        body: { code: RESTJSONErrorCodes.MissingPermissions, message: "Missing Permissions" },
    },
    cannotMessageUser: {
        status: 403,
        body: { code: RESTJSONErrorCodes.CannotSendMessagesToThisUser, message: "Cannot send messages to this user" },
    },
} as const;

const EPOCH = "2026-01-01T00:00:00.000Z";
const NO_ROLE_FLAGS = new RoleFlagsBitField().bitfield;
const NO_MEMBER_FLAGS = new GuildMemberFlagsBitField().bitfield;

export function apiUser(overrides: Partial<APIUser> = {}): APIUser {
    return {
        id: IDS.user,
        username: NAMES.username,
        discriminator: "0",
        global_name: NAMES.displayName,
        avatar: null,
        ...overrides,
    };
}

export function apiBotUser(): APIUser {
    return apiUser({ id: IDS.bot, username: "BustinBot", bot: true });
}

export function apiRole(overrides: Partial<APIRole> = {}): APIRole {
    return {
        id: SnowflakeUtil.generate().toString(),
        name: "role",
        color: 0,
        colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
        hoist: false,
        icon: null,
        unicode_emoji: null,
        position: 1,
        permissions: "0",
        managed: false,
        mentionable: false,
        flags: NO_ROLE_FLAGS,
        ...overrides,
    };
}

export function apiTextChannel(
    overrides: Partial<APIGuildTextChannel<ChannelType.GuildText>> = {},
): APIGuildTextChannel<ChannelType.GuildText> & { guild_id: string } {
    return {
        id: IDS.channel,
        type: ChannelType.GuildText,
        guild_id: IDS.guild,
        name: NAMES.channel,
        position: 0,
        parent_id: null,
        nsfw: false,
        topic: null,
        last_message_id: null,
        rate_limit_per_user: 0,
        permission_overwrites: [],
        ...overrides,
    };
}

export function apiVoiceChannel(
    overrides: Partial<APIGuildVoiceChannel> = {},
): APIGuildVoiceChannel & { guild_id: string } {
    return {
        id: SnowflakeUtil.generate().toString(),
        type: ChannelType.GuildVoice,
        guild_id: IDS.guild,
        name: "Movie Night",
        position: 1,
        parent_id: null,
        nsfw: false,
        last_message_id: null,
        rate_limit_per_user: 0,
        permission_overwrites: [],
        bitrate: 64000,
        user_limit: 0,
        rtc_region: null,
        ...overrides,
    };
}

export function apiResolvedChannel(
    overrides: Partial<APIInteractionDataResolvedChannel> = {},
): APIInteractionDataResolvedChannel {
    return { ...pick(apiTextChannel(), ["id", "name", "type"]), permissions: "0", ...overrides };
}

export function apiDMChannel(recipient: APIUser): APIDMChannel {
    return {
        id: SnowflakeUtil.generate().toString(),
        type: ChannelType.DM,
        name: null,
        last_message_id: null,
        recipients: [recipient],
    };
}

type MemberFields = Omit<APIGuildMember, "user">;
type GuildMemberParams = Partial<MemberFields> & { user?: Partial<APIUser> };
type MemberParams = Partial<Omit<APIInteractionGuildMember, "user">> & { user?: Partial<APIUser> };

function memberFields(): MemberFields {
    return {
        roles: [],
        joined_at: EPOCH,
        deaf: false,
        mute: false,
        flags: NO_MEMBER_FLAGS,
        avatar: null,
        banner: null,
    };
}

export function apiGuildMember({ user, ...overrides }: GuildMemberParams = {}): APIGuildMember {
    return { ...memberFields(), ...overrides, user: apiUser(user) };
}

export function apiMember({ user, ...overrides }: MemberParams = {}): APIInteractionGuildMember {
    return { ...memberFields(), permissions: "0", ...overrides, user: apiUser(user) };
}

export function apiAttachment(overrides: Partial<APIAttachment> = {}): APIAttachment {
    const id = overrides.id ?? SnowflakeUtil.generate().toString();
    const filename = overrides.filename ?? "screenshot.png";
    const path = `/attachments/${IDS.channel}/${id}/${filename}`;
    return {
        id,
        filename,
        size: 8,
        url: `${RouteBases.cdn}${path}`,
        proxy_url: `${RouteBases.media}${path}`,
        content_type: "image/png",
        ...overrides,
    };
}

export function apiMessage(overrides: Partial<APIMessage> = {}): APIMessage {
    return {
        id: SnowflakeUtil.generate().toString(),
        channel_id: IDS.channel,
        author: apiBotUser(),
        content: "",
        timestamp: EPOCH,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: MessageType.Default,
        ...overrides,
    };
}

export function apiGatewayBot(): APIGatewayBotInfo {
    return {
        url: "wss://gateway.discord.gg",
        shards: 1,
        session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
    };
}

export function apiReady(guildId: string): GatewayReadyDispatchData {
    return {
        v: Number(GatewayVersion),
        user: apiBotUser(),
        guilds: [{ id: guildId, unavailable: true }],
        session_id: "session",
        resume_gateway_url: apiGatewayBot().url,
        application: {
            id: IDS.application,
            flags: ApplicationFlags.ApplicationCommandBadge,
            flags_new: String(ApplicationFlags.ApplicationCommandBadge),
        },
    };
}

export function apiGuild(overrides: Partial<GatewayGuildCreateDispatchData> = {}): GatewayGuildCreateDispatchData {
    const id = overrides.id ?? IDS.guild;
    return {
        id,
        name: NAMES.guild,
        icon: null,
        splash: null,
        discovery_splash: null,
        owner_id: IDS.owner,
        afk_channel_id: null,
        afk_timeout: 300,
        verification_level: GuildVerificationLevel.None,
        default_message_notifications: GuildDefaultMessageNotifications.OnlyMentions,
        explicit_content_filter: GuildExplicitContentFilter.Disabled,
        roles: [
            apiRole({ id, name: "@everyone", position: 0 }),
            apiRole({ id: IDS.roles.admin, name: NAMES.roles.admin }),
            apiRole({ id: IDS.roles.taskAdmin, name: NAMES.roles.taskAdmin }),
            apiRole({ id: IDS.roles.movieAdmin, name: NAMES.roles.movieAdmin }),
            apiRole({ id: IDS.roles.taskUser, name: NAMES.roles.taskUser }),
        ],
        emojis: [],
        features: [],
        mfa_level: GuildMFALevel.None,
        application_id: null,
        system_channel_id: null,
        system_channel_flags: GuildSystemChannelFlags.SuppressJoinNotifications,
        rules_channel_id: null,
        vanity_url_code: null,
        description: null,
        banner: null,
        premium_tier: GuildPremiumTier.None,
        preferred_locale: Locale.EnglishGB,
        public_updates_channel_id: null,
        nsfw_level: GuildNSFWLevel.Default,
        premium_progress_bar_enabled: false,
        safety_alerts_channel_id: null,
        stickers: [],
        hub_type: null,
        incidents_data: null,
        region: "",
        joined_at: EPOCH,
        large: false,
        member_count: 1,
        members: [],
        channels: [apiTextChannel()],
        threads: [],
        presences: [],
        voice_states: [],
        stage_instances: [],
        guild_scheduled_events: [],
        soundboard_sounds: [],
        unavailable: false,
        ...overrides,
    };
}

export function apiOtherGuild(): GatewayGuildCreateDispatchData {
    return apiGuild({
        id: IDS.otherGuild,
        channels: [apiTextChannel({ id: IDS.otherGuildChannel, guild_id: IDS.otherGuild })],
    });
}

export type MessageCreateParams = Partial<Omit<GatewayMessageCreateDispatchData, "member">> & {
    member?: Partial<MemberFields>;
};

export function messageCreate(
    content: string,
    { member, ...overrides }: MessageCreateParams = {},
): GatewayMessageCreateDispatchData {
    return {
        ...apiMessage({ content, author: apiUser() }),
        guild_id: IDS.guild,
        member: { ...memberFields(), ...member },
        mentions: [],
        ...overrides,
    };
}

export function directMessage(
    content: string,
    overrides: Partial<GatewayMessageCreateDispatchData> = {},
): GatewayMessageCreateDispatchData {
    return {
        ...apiMessage({ content, author: apiUser(), channel_id: IDS.dm }),
        channel_type: ChannelType.DM,
        mentions: [],
        ...overrides,
    };
}

export function apiVoiceState(
    userId: string,
    channelId: string | null,
    overrides: Partial<APIVoiceState> = {},
): APIVoiceState & { guild_id: string } {
    return {
        guild_id: IDS.guild,
        channel_id: channelId,
        user_id: userId,
        member: apiGuildMember({ user: { id: userId } }),
        session_id: `session-${userId}`,
        deaf: false,
        mute: false,
        self_deaf: false,
        self_mute: false,
        self_video: false,
        suppress: false,
        request_to_speak_timestamp: null,
        ...overrides,
    };
}

const interactionBase = {
    application_id: IDS.application,
    guild_id: IDS.guild,
    version: 1 as const,
    app_permissions: "0",
    locale: Locale.EnglishGB,
    guild_locale: Locale.EnglishGB,
    entitlements: [],
    authorizing_integration_owners: {},
    context: InteractionContextType.Guild,
    attachment_size_limit: 10_485_760,
};

type InteractionParams<T> = Partial<Omit<T, "member">> & { member?: MemberParams };

function interactionFields(member?: MemberParams) {
    const channel = pick(apiTextChannel(), ["id", "type", "guild_id", "name"]);
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        channel,
        channel_id: channel.id,
        member: apiMember(member),
    };
}

export const PRIVATE_DEFERRAL = {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: MessageFlags.Ephemeral },
};

export const AS = {
    botAdmin: { member: { roles: [IDS.roles.admin] } },
    taskAdmin: { member: { roles: [IDS.roles.taskAdmin] } },
    movieAdmin: { member: { roles: [IDS.roles.movieAdmin] } },
};

export function subcommand(
    name: string,
    options: APIApplicationCommandInteractionDataBasicOption[] = [],
): APIApplicationCommandInteractionDataSubcommandOption {
    return { type: ApplicationCommandOptionType.Subcommand, name, options };
}

export function chatInputInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
    { member, ...overrides }: InteractionParams<APIChatInputApplicationCommandGuildInteraction> = {},
    resolved?: APIInteractionDataResolved,
): APIChatInputApplicationCommandGuildInteraction {
    return {
        ...interactionFields(member),
        type: InteractionType.ApplicationCommand,
        data: {
            id: SnowflakeUtil.generate().toString(),
            name,
            type: ApplicationCommandType.ChatInput,
            options,
            ...(resolved ? { resolved } : {}),
        },
        ...overrides,
    };
}

export function autocompleteInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[],
    { member, ...overrides }: InteractionParams<APIApplicationCommandAutocompleteGuildInteraction> = {},
): APIApplicationCommandAutocompleteGuildInteraction {
    return {
        ...interactionFields(member),
        type: InteractionType.ApplicationCommandAutocomplete,
        data: {
            id: SnowflakeUtil.generate().toString(),
            name,
            type: ApplicationCommandType.ChatInput,
            options,
        },
        ...overrides,
    };
}

export function buttonInteraction(
    customId: string,
    message: APIMessage = apiMessage(),
    { member, ...overrides }: InteractionParams<APIMessageComponentButtonInteraction> = {},
): APIMessageComponentButtonInteraction {
    const data: APIMessageButtonInteractionData = { custom_id: customId, component_type: ComponentType.Button };
    return {
        ...interactionFields(member),
        type: InteractionType.MessageComponent,
        data,
        message,
        ...overrides,
    };
}

type SelectParams = InteractionParams<APIMessageComponentSelectMenuInteraction>;

function selectInteraction(
    data: APIMessageSelectMenuInteractionData,
    message: APIMessage,
    { member, ...overrides }: SelectParams,
): APIMessageComponentSelectMenuInteraction {
    return {
        ...interactionFields(member),
        type: InteractionType.MessageComponent,
        data,
        message,
        ...overrides,
    };
}

export function channelSelectInteraction(
    customId: string,
    channelIds: string[],
    message: APIMessage = apiMessage(),
    overrides: SelectParams = {},
): APIMessageComponentSelectMenuInteraction {
    const channels = Object.fromEntries(channelIds.map((id) => [id, apiResolvedChannel({ id, name: "channel" })]));
    return selectInteraction(
        {
            custom_id: customId,
            component_type: ComponentType.ChannelSelect,
            values: channelIds,
            resolved: { channels },
        },
        message,
        overrides,
    );
}

export function roleSelectInteraction(
    customId: string,
    roleIds: string[],
    message: APIMessage = apiMessage(),
    overrides: SelectParams = {},
): APIMessageComponentSelectMenuInteraction {
    const roles = Object.fromEntries(roleIds.map((id) => [id, apiRole({ id })]));
    return selectInteraction(
        { custom_id: customId, component_type: ComponentType.RoleSelect, values: roleIds, resolved: { roles } },
        message,
        overrides,
    );
}

export function stringSelectInteraction(
    customId: string,
    values: string[],
    message: APIMessage = apiMessage(),
    overrides: SelectParams = {},
): APIMessageComponentSelectMenuInteraction {
    return selectInteraction(
        { custom_id: customId, component_type: ComponentType.StringSelect, values },
        message,
        overrides,
    );
}

export function modalSubmitInteraction(
    customId: string,
    fields: Record<string, string | string[]>,
    { member, ...overrides }: InteractionParams<APIModalSubmitGuildInteraction> = {},
): APIModalSubmitGuildInteraction {
    return {
        ...interactionFields(member),
        type: InteractionType.ModalSubmit,
        data: {
            custom_id: customId,
            components: Object.entries(fields).map(([fieldId, value]) => ({
                type: ComponentType.Label,
                component: Array.isArray(value)
                    ? { type: ComponentType.StringSelect, custom_id: fieldId, values: value }
                    : { type: ComponentType.TextInput, custom_id: fieldId, value },
            })),
        },
        ...overrides,
    };
}

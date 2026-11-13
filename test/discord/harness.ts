import { Collection } from "@discordjs/collection";
import {
    type APIRequest,
    Client,
    Events,
    type Interaction,
    type Message,
    REST,
    RESTEvents,
    type VoiceState,
} from "discord.js";
import {
    type IShardingStrategy,
    type WebSocketManager,
    WebSocketShardEvents,
    WebSocketShardStatus,
} from "@discordjs/ws";
import {
    GatewayDispatchEvents,
    GatewayOpcodes,
    InteractionResponseType,
    InteractionType,
    RouteBases,
    Routes,
    type APIAttachment,
    type APIChannel,
    type APIGuild,
    type APIGuildMember,
    type APIInteraction,
    type APIInteractionResponseCallbackData,
    type APIMessage,
    type APIModalInteractionResponseCallbackData,
    type APIRole,
    type APIUser,
    type GatewayChannelCreateDispatchData,
    type GatewayDispatchPayload,
    type GatewayGuildCreateDispatchData,
    type GatewayMessageCreateDispatchData,
    type GatewayVoiceStateUpdateDispatchData,
    type RESTPatchAPIWebhookWithTokenMessageJSONBody,
    type RESTPostAPIChannelMessageJSONBody,
    type RESTPostAPICurrentUserCreateDMChannelJSONBody,
    type RESTPostAPIInteractionCallbackJSONBody,
    type RESTPutAPIApplicationGuildCommandsJSONBody,
} from "discord-api-types/v10";
import type { Interceptable, MockAgent } from "undici";
import type { MockInterceptor } from "undici/types/mock-interceptor.js";
import { clientOptions } from "../../src/clientOptions.js";
import { JSON_REPLY } from "../firestoreEmulator.js";
import { DiscordError, IDS, apiDMChannel, apiGatewayBot, apiGuild, apiMessage, apiReady } from "./payloads.js";

export type SentMessage = RESTPostAPIChannelMessageJSONBody & { files?: string[] };

const API = new URL(RouteBases.api);

// Keeps each event name paired with its own data
type Dispatch<Payload> = Payload extends unknown ? Omit<Payload, "op" | "s"> : never;
type DispatchEvent = Dispatch<GatewayDispatchPayload>;

class TestGateway implements IShardingStrategy {
    constructor(
        private readonly manager: WebSocketManager,
        private readonly guild: GatewayGuildCreateDispatchData,
    ) {}

    connect(): void {
        const ready = apiReady(this.guild.id);
        this.manager.emit(WebSocketShardEvents.Ready, { data: ready, shardId: 0 });
        this.dispatch({ t: GatewayDispatchEvents.Ready, d: ready });
        this.dispatch({ t: GatewayDispatchEvents.GuildCreate, d: this.guild });
    }

    dispatch(event: DispatchEvent): void {
        this.manager.emit(WebSocketShardEvents.Dispatch, {
            data: { op: GatewayOpcodes.Dispatch, s: 0, ...event },
            shardId: 0,
        });
    }

    spawn(): void {}

    destroy(): void {}

    send(): void {}

    fetchStatus(): Collection<number, WebSocketShardStatus> {
        return new Collection([[0, WebSocketShardStatus.Ready]]);
    }
}

export class DiscordHarness {
    readonly client: Client;
    readonly requests: APIRequest[] = [];
    private readonly api: Interceptable;
    private readonly guild = apiGuild();
    private gateway: TestGateway | undefined;

    constructor(private readonly http: MockAgent) {
        this.api = http.get(API.origin);
        this.client = new Client({
            ...clientOptions,
            ws: { buildStrategy: (manager) => (this.gateway = new TestGateway(manager, this.guild)) },
        });
        this.client.rest.on(RESTEvents.Response, (request) => this.requests.push(request));
    }

    async connect(): Promise<void> {
        this.serve("GET", Routes.gatewayBot(), apiGatewayBot(), { persist: false });
        const ready = Client.once(this.client, Events.ClientReady);
        await this.client.login("test-token");
        await ready;
        this.requests.length = 0;
    }

    async addGuild(guild: GatewayGuildCreateDispatchData): Promise<void> {
        const created = Client.once(this.client, Events.GuildCreate);
        this.send({ t: GatewayDispatchEvents.GuildCreate, d: guild });
        await created;
    }

    async addRole(guildId: string, role: APIRole): Promise<void> {
        const created = Client.once(this.client, Events.GuildRoleCreate);
        this.send({ t: GatewayDispatchEvents.GuildRoleCreate, d: { guild_id: guildId, role } });
        await created;
    }

    async addChannel(channel: GatewayChannelCreateDispatchData): Promise<void> {
        const created = Client.once(this.client, Events.ChannelCreate);
        this.send({ t: GatewayDispatchEvents.ChannelCreate, d: channel });
        await created;
    }

    async updateVoiceState(state: GatewayVoiceStateUpdateDispatchData): Promise<[VoiceState, VoiceState]> {
        const updated = Client.once(this.client, Events.VoiceStateUpdate);
        this.send({ t: GatewayDispatchEvents.VoiceStateUpdate, d: state });
        return updated;
    }

    async sendInteraction(payload: APIInteraction): Promise<Interaction> {
        // Interaction responses send ?with_response=false (InteractionResponses.js); autocomplete sends no query
        // (AutocompleteInteraction.js:86)
        this.route(
            "POST",
            Routes.interactionCallback(payload.id, payload.token),
            payload.type === InteractionType.ApplicationCommandAutocomplete
                ? {}
                : { query: { with_response: "false" } },
        ).reply(204);
        this.acceptMessagesAt("PATCH", `${Routes.webhook(IDS.application, payload.token)}/messages/`, { prefix: true });
        this.acceptMessagesAt("POST", Routes.webhook(IDS.application, payload.token), { query: { wait: "true" } });
        const created = Client.once(this.client, Events.InteractionCreate);
        this.send({ t: GatewayDispatchEvents.InteractionCreate, d: payload });
        const [interaction] = await created;
        return interaction;
    }

    async sendMessage(payload: GatewayMessageCreateDispatchData): Promise<Message> {
        const created = Client.once(this.client, Events.MessageCreate);
        this.send({ t: GatewayDispatchEvents.MessageCreate, d: payload });
        const [message] = await created;
        return message;
    }

    refuse(
        method: string,
        route: string,
        { status, body }: (typeof DiscordError)[keyof typeof DiscordError],
        { persist = false } = {},
    ): void {
        const refused = this.route(method, route).reply(status, body, JSON_REPLY);
        if (persist) refused.persist();
    }

    serveChannel(channel: APIChannel): void {
        this.serve("GET", Routes.channel(channel.id), channel);
    }

    serveMessage(message: APIMessage): void {
        this.serve("GET", Routes.channelMessage(message.channel_id, message.id), message);
    }

    serveGuild(guild: APIGuild): void {
        this.serve("GET", Routes.guild(guild.id), guild, { query: { with_counts: "true" } });
    }

    serveGuildChannels(guildId: string, channels: APIChannel[]): void {
        this.serve("GET", Routes.guildChannels(guildId), channels);
    }

    serveGuildRoles(extra: APIRole[] = []): void {
        this.serve("GET", Routes.guildRoles(this.guild.id), [...this.guild.roles, ...extra]);
    }

    serveUser(user: APIUser): void {
        this.serve("GET", Routes.user(user.id), user);
    }

    serveMember(guildId: string, member: APIGuildMember): void {
        this.serve("GET", Routes.guildMember(guildId, member.user.id), member);
        for (const method of ["PUT", "DELETE"]) {
            this.route(method, `${Routes.guildMember(guildId, member.user.id)}/roles/`, { prefix: true })
                .reply(204)
                .persist();
        }
    }

    serveAttachment(attachment: APIAttachment, contents: Uint8Array = new Uint8Array()): void {
        const { origin, pathname } = new URL(attachment.url);
        this.http.get(origin).intercept({ path: pathname }).reply(200, Buffer.from(contents)).persist();
    }

    acceptMessages(channelId: string): void {
        this.acceptMessagesAt("POST", Routes.channelMessages(channelId));
    }

    acceptMessageEdits(channelId: string): void {
        this.acceptMessagesAt("PATCH", `${Routes.channelMessages(channelId)}/`, { prefix: true });
    }

    acceptMessageDeletions(channelId: string): void {
        this.route("DELETE", `${Routes.channelMessages(channelId)}/`, { prefix: true })
            .reply(204)
            .persist();
    }

    acceptDirectMessages(user: APIUser): string {
        const dm = this.openDirectMessages(user);
        this.acceptMessages(dm);
        return dm;
    }

    refuseDirectMessages(user: APIUser): void {
        this.refuse("POST", Routes.channelMessages(this.openDirectMessages(user)), DiscordError.cannotMessageUser, {
            persist: true,
        });
    }

    acceptCommandSync(route: string): void {
        this.serve("PUT", route, []);
    }

    acceptRoleCreation(guildId: string, role: APIRole): void {
        this.serve("POST", Routes.guildRoles(guildId), role, { persist: false });
    }

    acceptRoleEdit(guildId: string, role: APIRole): void {
        this.serve("PATCH", Routes.guildRole(guildId, role.id), role, { persist: false });
    }

    acceptRoleDeletion(guildId: string, roleId: string): void {
        this.route("DELETE", Routes.guildRole(guildId, roleId)).reply(204);
    }

    callbacks(interaction: Interaction): RESTPostAPIInteractionCallbackJSONBody[] {
        return this.bodies("POST", Routes.interactionCallback(interaction.id, interaction.token));
    }

    async callback(interaction: Interaction): Promise<RESTPostAPIInteractionCallbackJSONBody> {
        await this.sentOnce("POST", Routes.interactionCallback(interaction.id, interaction.token));
        const [callback] = this.callbacks(interaction);
        if (!callback) throw new Error(`Interaction ${interaction.id} was never answered.`);
        return callback;
    }

    reply(interaction: Interaction): APIInteractionResponseCallbackData | undefined {
        return this.callbacks(interaction).find(
            (sent) => sent.type === InteractionResponseType.ChannelMessageWithSource,
        )?.data;
    }

    modal(interaction: Interaction): APIModalInteractionResponseCallbackData | undefined {
        return this.callbacks(interaction).find((sent) => sent.type === InteractionResponseType.Modal)?.data;
    }

    originalEdits(interaction: Interaction): RESTPatchAPIWebhookWithTokenMessageJSONBody[] {
        return this.bodies("PATCH", Routes.webhookMessage(IDS.application, interaction.token, "@original"));
    }

    async originalEdit(interaction: Interaction): Promise<RESTPatchAPIWebhookWithTokenMessageJSONBody> {
        await this.sentOnce("PATCH", Routes.webhookMessage(IDS.application, interaction.token, "@original"));
        const [edit] = this.originalEdits(interaction);
        if (!edit) throw new Error(`Interaction ${interaction.id}'s reply was never edited.`);
        return edit;
    }

    followUps(interaction: Interaction): SentMessage[] {
        return this.sentMessages("POST", Routes.webhook(IDS.application, interaction.token));
    }

    messagesSentTo(channelId: string): SentMessage[] {
        return this.sentMessages("POST", Routes.channelMessages(channelId));
    }

    messageEdits(channelId: string, messageId: string): SentMessage[] {
        return this.sentMessages("PATCH", Routes.channelMessage(channelId, messageId));
    }

    messageDeletions(channelId: string): string[] {
        return this.pathIds("DELETE", `${Routes.channelMessages(channelId)}/:message`)
            .map(({ message }) => message)
            .filter((message) => message !== undefined);
    }

    memberRoleChanges(method: "PUT" | "DELETE"): Record<"member" | "role", string | undefined>[] {
        return this.pathIds(method, "/guilds/:guild/members/:member/roles/:role").map(({ member, role }) => ({
            member,
            role,
        }));
    }

    roleCreations(guildId: string): Partial<APIRole>[] {
        return this.bodies("POST", Routes.guildRoles(guildId));
    }

    commandUpdates(route: string): RESTPutAPIApplicationGuildCommandsJSONBody[] {
        return this.bodies("PUT", route);
    }

    private send(event: DispatchEvent): void {
        if (!this.gateway) throw new Error("The client has not connected to the gateway yet.");
        this.gateway.dispatch(event);
    }

    private route(
        method: string,
        route: string,
        { prefix = false, ...match }: { prefix?: boolean } & Pick<MockInterceptor.Options, "query" | "body"> = {},
    ) {
        const path = `${API.pathname}${route}`;
        return this.api.intercept({ ...match, method, path: prefix ? (sent) => sent.startsWith(path) : path });
    }

    private serve(
        method: string,
        route: string,
        data: object,
        { persist = true, ...match }: { persist?: boolean } & Pick<MockInterceptor.Options, "query"> = {},
    ): void {
        const served = this.route(method, route, match).reply(200, data, JSON_REPLY);
        if (persist) served.persist();
    }

    private acceptMessagesAt(
        method: string,
        route: string,
        options: { prefix?: boolean } & Pick<MockInterceptor.Options, "query"> = {},
    ): void {
        this.route(method, route, options)
            .reply(200, () => apiMessage(), JSON_REPLY)
            .persist();
    }

    private openDirectMessages(user: APIUser): string {
        const dm = apiDMChannel(user);
        this.serve("GET", Routes.user(user.id), user);
        this.route("POST", Routes.userChannels(), {
            body: (sent) =>
                (JSON.parse(sent) as RESTPostAPICurrentUserCreateDMChannelJSONBody).recipient_id === user.id,
        })
            .reply(200, dm, JSON_REPLY)
            .persist();
        return dm.id;
    }

    private sentTo(method: string, path: string): APIRequest[] {
        return this.requests.filter((request) => request.method === method && request.path === path);
    }

    private async sentOnce(method: string, path: string): Promise<void> {
        while (!this.sentTo(method, path).length) {
            await REST.once(this.client.rest, RESTEvents.Response);
        }
    }

    private pathIds(method: string, pathname: string): Record<string, string | undefined>[] {
        const pattern = new URLPattern({ pathname });
        return this.requests.flatMap((request) => {
            const match = request.method === method && pattern.exec({ pathname: request.path });
            return match ? [match.pathname.groups] : [];
        });
    }

    private bodies<Body>(method: string, path: string): Body[] {
        return this.sentTo(method, path).map((request) => request.data.body as Body);
    }

    private sentMessages(method: string, path: string): SentMessage[] {
        return this.sentTo(method, path).map(({ data }) => {
            const message = data.body as RESTPostAPIChannelMessageJSONBody;
            return data.files ? { ...message, files: data.files.map((file) => file.name) } : message;
        });
    }
}

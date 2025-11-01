import { servicesVersion } from "typescript";
import type { GuildService } from "./GuildService.js";

type SetupType = "core" | "movie" | "task";
type SelectionMap = Record<string, string>;

const REQUIRED_FIELDS: Record<SetupType, string[]> = {
    core: ["announcements", "botLog", "botArchive"],
    movie: ["movieAdmin", "movieUser", "movieNight", "movieVC"],
    task: ["taskAdmin", "taskUser", "taskChannel", "taskVerification"],
};

type PayloadBuilder = (selections: SelectionMap) => Record<string, unknown>;

const PAYLOAD_BUILDERS: Record<SetupType, PayloadBuilder> = {
    core: (selections) => ({
        channels: {
            announcements: selections.announcements ?? "",
            botLog: selections.botLog ?? "",
            botArchive: selections.botArchive ?? "",
        },
        setupComplete: {
            core: true,
        },
    }),
    movie: (selections) => ({
        roles: {
            movieAdmin: selections.movieAdmin ?? "",
            movieUser: selections.movieUser ?? "",
        },
        channels: {
            movieNight: selections.movieNight ?? "",
            movieVC: selections.movieVC ?? "",
        },
        setupComplete: {
            movie: true,
        }
    }),
    task: (selections) => ({
        roles: {
            taskAdmin: selections.taskAdmin ?? "",
            taskUser: selections.taskUser ?? "",
        },
        channels: {
            taskChannel: selections.taskChannel ?? "",
            taskVerification: selections.taskVerification ?? "",
        },
        setupComplete: {
            task: true,
        }
    }),
};

export class SetupService {
    private readonly selections: Record<SetupType, Map<string, SelectionMap>> = {
        core: new Map(),
        movie: new Map(),
        task: new Map(),
    };

    setSelection(type: SetupType, userId: string, key: string, value: string) {
        const map = this.selections[type];
        const current = map.get(userId) ?? {};
        current[key] = value;
        map.set(userId, current);
    }

    getSelections(type: SetupType, userId: string): SelectionMap | undefined {
        return this.selections[type].get(userId);
    }

    clearSelections(type: SetupType, userId: string) {
        this.selections[type].delete(userId);
    }

    getMissingFields(type: SetupType, selections?: SelectionMap): string[] {
        if (!selections) return [...REQUIRED_FIELDS[type]];
        return REQUIRED_FIELDS[type].filter((field) => !selections[field]);
    }

    async persist(
        type: SetupType,
        guildService: GuildService,
        guildId: string,
        selections: SelectionMap
    ) {
        const builder = PAYLOAD_BUILDERS[type];
        const payload = builder(selections);

        const guild = await guildService.get(guildId);
        const currentSetup = guild?.setupComplete ?? {};
        const existingChannels = guild?.channels ?? {};
        const existingRoles = guild?.roles ?? {};

        // Merge setupComplete state
        payload.setupComplete = {
            ...currentSetup,
            ...(payload.setupComplete as Record<string, boolean>),
        };

        // Merge channels/roles to avoid overwriting other module configs
        if (payload.channels) {
            payload.channels = {
                ...existingChannels,
                ...(payload.channels as Record<string, string>),
            };
        }
        if (payload.roles) {
            payload.roles = {
                ...existingRoles,
                ...(payload.roles as Record<string, string>),
            };
        }

        // Persist full merged payload
        console.log("[SetupService] Payload being sent to GuildService.update:", JSON.stringify(payload, null, 2));
        await guildService.update(guildId, payload);
        await guildService.refresh(guildId);

        console.log(`[SetupService] Persisted ${type} setup for ${guildId}`);
    }

}

export const setupService = new SetupService();

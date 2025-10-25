import { servicesVersion } from "typescript";
import type { GuildService } from "./GuildService";

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

        payload.setupComplete = {
            ...currentSetup,
            ...(payload.setupComplete as Record<string, boolean>),
        };
        await guildService.update(guildId, builder(selections));
        await guildService.refresh(guildId);
    }
}

export const setupService = new SetupService();

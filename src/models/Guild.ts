export interface GuildChannels {
    announcements?: string;
    botArchive?: string;
    botLog?: string;
    taskChannel?: string;
    taskVerification?: string;
    movieNight?: string;
    movieVC?: string;
}

export interface GuildRoles {
    admin?: string;
    movieAdmin?: string;
    movieUser?: string;
    taskAdmin?: string;
    taskUser?: string;
    taskChampionFirst?: string;
    taskChampionSecond?: string;
    taskChampionThird?: string;
}

export interface GuildSetupComplete {
    core?: boolean;
    movie?: boolean;
    task?: boolean;
}

export interface TaskMilestoneRole {
    id: string;
    label: string;
    roleId: string;
    requiredSubmissions: number;
    enabled: boolean;
}

export interface TaskSettings {
    periodEvents?: number;
    milestoneRoles?: TaskMilestoneRole[];
    championRoles?: {
        first?: boolean;
        second?: boolean;
        third?: boolean;
    };
}

export interface Guild {
  id: string;

  toggles: {
    taskScheduler: boolean;
    leaguesEnabled: boolean;
    taskLeaderboard?: boolean;
  };

  roles: GuildRoles;
  channels: GuildChannels;
  taskSettings?: TaskSettings;

  setupComplete?: GuildSetupComplete;
  mentionSuppressedUntilMs?: number;
  // In IANA format (e.g. 'Australia/Melbourne')
  timezone?: string;
  updatedBy?: string;
  updatedAt?: Date;
}

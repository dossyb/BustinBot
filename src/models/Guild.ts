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
}

export interface Guild {
  id: string;

  toggles: {
    taskScheduler: boolean;
    leaguesEnabled: boolean;
  };

  roles: GuildRoles;
  channels: GuildChannels;

  setupComplete?: boolean;
  updatedBy?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
}

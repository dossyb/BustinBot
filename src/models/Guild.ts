export interface Guild {
  id: string;

  toggles: {
    taskScheduler: boolean;
  };

  roles: {
    admin: string;
    movieAdmin?: string;
    movieUser?: string;
    taskAdmin?: string;
    taskUser?: string;
  };

  channels: {
    taskChannel: string;
    taskVerification: string;
    movieNight: string;
    movieVC: string;
  };

  setupComplete?: boolean;
  updatedBy?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
}

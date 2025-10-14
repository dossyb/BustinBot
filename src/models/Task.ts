// Broad categories for variety
export enum TaskCategory {
    Skilling = 'Skilling',
    PvM = 'PvM',
    Minigame = 'Minigame',
    Misc = 'Misc',
    Leagues = 'Leagues'
}

// Distinguishes how the task is completed
export enum TaskType {
    XP = 'XP',
    KC = 'KC',
    Drop = 'Drop',
    Inventory = 'Inventory',
    Points = 'Points',
    Materials = 'Materials',
    Other = 'Other'
}

export enum Skill {
    Agility = 'Agility',
    Prayer = 'Prayer',
    Magic = 'Magic',
    Runecraft = 'Runecraft',
    Crafting = 'Crafting',
    Mining = 'Mining',
    Smithing = 'Smithing',
    Fishing = 'Fishing',
    Cooking = 'Cooking',
    Firemaking = 'Firemaking',
    Woodcutting = 'Woodcutting',
    Herblore = 'Herblore',
    Thieving = 'Thieving',
    Fletching = 'Fletching',
    Slayer = 'Slayer',
    Farming = 'Farming',
    Construction = 'Construction',
    Hunter = 'Hunter',
    Sailing = 'Sailing'
}

export interface Task {
    // Unique identifier for the task
    id: string;

    // The task description, may contain {amount} placeholder(s)
    taskName: string;

    // Legacy amounts
    amounts?: number[];

    // Category of the task
    category: TaskCategory;
    
    // Type of task
    type: TaskType;

    // Skill category (if relevant to task)
    skill?: Skill;

    // New three-tier amounts for bronze, silver, and gold completions
    amtBronze: number;
    amtSilver: number;
    amtGold: number;

    // Weighting based on user feedback
    weight?: number;

    // Short hand name for quick reference (e.g. task poll buttons)
    shortName?: string;

    // XP per action for skilling tasks
    xpPerAction?: number;

    // Minimum XP gained for each tier of completion - to assist admins in verification
    minXPBronze?: number;
    minXPSilver?: number;
    minXPGold?: number;

    // Flag to dynamically display skull next to task name
    wildernessReq?: boolean;

    // Data for user-suggested tasks
    addedBy?: string;
    approvedBy?: string;
}
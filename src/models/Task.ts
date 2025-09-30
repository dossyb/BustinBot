// Legacy verification logic
export enum TaskInstruction {
    ScreenshotsRequired = 1,
    ProgressionBased = 2,
    ExperienceBased = 3
}

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
    Other = 'Other'
}

export interface Task {
    // Unique identifier for the task
    id: number;

    // The task description, may contain {amount} placeholder(s)
    taskName: string;

    // Optional list of possible amounts (e.g. [25, 50, 100])
    amounts?: number[];

    // Instruction code (legacy logic decides how to handle/verify the task)
    instruction: TaskInstruction;

    // Category of the task
    category: TaskCategory;
    
    // Type of task
    type: TaskType;

    // Weighting based on user feedback
    weight?: number;
}
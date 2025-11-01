import { TaskType } from "../../models/Task.js";

export const TaskInstructions: Record<TaskType, string> = {
    [TaskType.XP]:
        'Submit **before and after screenshots** showing your XP in the relevant skill with the **keyword** visible. RuneLite users are recommended to use the XP tracker overlay for eassy verification.',
    [TaskType.KC]:
        'Submit **before and after screenshots** of your Kill Count for the relevant boss/activity with the **keyword** visible. This can be via the collection log, kill notification messages, or KC overlays.',
    [TaskType.Drop]:
        'Submit a **screenshot** showing the relevant item drop on the ground or in your inventory with the **keyword** visible. For unique/rare drops, multiple screenshots are recommended showing each drop.',
    [TaskType.Inventory]:
        'Submit a **screenshot** showing your inventory with the required amount of items with the **keyword** visible. The XP gained from completing the task should be visible, such as via an XP overlay or a before and after screenshot.',
    [TaskType.Points]:
        'Submit a **before and after screenshot** of your point total for the relevant activity with the **keyword** visible. This can be done via the in-game points counter or RuneLite overlay.',
    [TaskType.Materials]:
        'Submit a **screenshot** showing the relevant materials (can be noted) in your inventory or bank **before** starting the task, and a **second screenshot** showing the stack depleted after completion. XP gained must be shown via an XP tracker or before/after skill level. Include the **keyword** in both screenshots.',
    [TaskType.Other]:
        'Submit **screenshots** or other proof as specified by the task with the **keyword** visible.'
};
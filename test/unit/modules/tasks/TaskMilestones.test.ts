import { describe, expect, test } from "vitest";
import { getHighestMilestone } from "../../../../src/modules/tasks/TaskMilestones.js";
import { milestoneRoleFactory } from "../../../factories.js";

describe("TaskMilestones helpers", () => {
    test("skips disabled milestones", () => {
        const participant = milestoneRoleFactory.build({ requiredSubmissions: 5 });
        const disabled = milestoneRoleFactory.build({ requiredSubmissions: 25, enabled: false });

        expect(getHighestMilestone([participant, disabled], 30)?.id).toBe(participant.id);
    });
});

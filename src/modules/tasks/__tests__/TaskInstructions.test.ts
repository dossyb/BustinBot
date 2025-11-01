import { describe, it, expect } from 'vitest';

import { TaskInstructions } from '../../tasks/TaskInstructions';
import { TaskType } from '../../../models/Task';

describe('TaskInstructions mapping', () => {
    it('provides instructions for every task type', () => {
        const types = Object.values(TaskType);
        for (const type of types) {
            expect(TaskInstructions[type as TaskType]).toBeTruthy();
            expect(typeof TaskInstructions[type as TaskType]).toBe('string');
        }
    });
});

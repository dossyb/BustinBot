export const scheduledTasks: any[] = [];

function schedule(expression: string, callback: Function) {
    const task = {
        expression,
        callback,
        stop: vi.fn(),
    };
    scheduledTasks.push(task);
    return task;
}

export default { schedule };

export { schedule };
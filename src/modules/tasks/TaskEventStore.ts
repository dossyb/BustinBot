import fs from 'fs';
import path from 'path';
import type { TaskEvent } from '../../models/TaskEvent';

const eventFilePath = path.resolve(process.cwd(), 'src/data/taskEvents.json');

let cachedEvents: TaskEvent[] = fs.existsSync(eventFilePath)
    ? JSON.parse(fs.readFileSync(eventFilePath, 'utf-8'), (key, value) => {
        if (key === 'startTime' || key === 'endTime' || key === 'createdAt') {
            return new Date(value);
        }
        return value;
    })
    : [];

// Save in-memory cache to disk
function saveEvents() {
    fs.writeFileSync(eventFilePath, JSON.stringify(cachedEvents, null, 2));
}

// Create + store new event
export function storeTaskEvent(event: TaskEvent) {
    cachedEvents.push(event);
    saveEvents();
}
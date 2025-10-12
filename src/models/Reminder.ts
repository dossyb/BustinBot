import type { DateTime } from "luxon";

export interface Reminder {
    sendAt: DateTime;
    label: string;
    movieStartUTC?: string;
}
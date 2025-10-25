
type FirestoreTimestampLike = {
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
};

function convertToDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;

    if (typeof value === "object") {
        const timestamp = value as FirestoreTimestampLike;
        if (typeof timestamp.toDate === "function") {
            const date = timestamp.toDate();
            return Number.isNaN(date.getTime()) ? null : date;
        }

        if (
            typeof timestamp.seconds === "number" &&
            typeof timestamp.nanoseconds === "number"
        ) {
            const millis =
                timestamp.seconds * 1000 + Math.floor(timestamp.nanoseconds / 1e6);
            const date = new Date(millis);
            return Number.isNaN(date.getTime()) ? null : date;
        }
    }

    return null;
}

export function normaliseFirestoreDates<T extends Record<string, any>>(data: T): T {
    const clone = { ...data };
    for (const key in clone) {
        const maybeDate = convertToDate(clone[key]);
        if (maybeDate) {
            clone[key] = maybeDate as T[typeof key];
        }
    }
    return clone;
}


export function normaliseFirestoreDates<T extends Record<string, any>>(data: T): T {
    const clone = { ...data };
    for (const key in clone) {
        if (clone[key] && typeof clone[key].toDate === 'function') {
            clone[key] = clone[key].toDate();
        }
    }
    return clone;
}
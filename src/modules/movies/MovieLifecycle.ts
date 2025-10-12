import fs from 'fs';
import path from 'path';
import type { Movie } from '../../models/Movie';
import { DateTime } from 'luxon';

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');
const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');
const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');
const historyPath = path.resolve(process.cwd(), 'src/data/movieHistory.json');

let autoEndTimeout: NodeJS.Timeout | null = null;

// Marks the current movie night as completed and archives it
export async function finishMovieNight(endedBy: string): Promise<{ success: boolean; message: string; finishedMovie?: Movie }> {
    if (!fs.existsSync(currentMoviePath)) {
        return { success: false, message: "No active movie found to end." };
    }

    const currentMovie: Movie = JSON.parse(fs.readFileSync(currentMoviePath, 'utf-8'));
    const movieNightData = fs.existsSync(movieNightPath)
        ? JSON.parse(fs.readFileSync(movieNightPath, 'utf-8'))
        : null;

    // Load or initialise movie history
    const history: any[] = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
        : [];

    const completedEntry = {
        ...currentMovie,
        finishedAt: new Date().toISOString(),
        scheduledFor: movieNightData?.storedUTC || null,
        endedBy,
    };

    history.push(completedEntry);

    // Persist updated history
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

    // Remove movie from active list if it exists there
    if (fs.existsSync(movieFilePath)) {
        const allMovies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, 'utf-8'));
        const updatedMovies = allMovies.filter((m) => m.id !== currentMovie.id);
        fs.writeFileSync(movieFilePath, JSON.stringify(updatedMovies, null, 2));
    }

    // Clear current and scheduled movie data
    if (fs.existsSync(currentMoviePath)) fs.unlinkSync(currentMoviePath);
    if (fs.existsSync(movieNightPath)) fs.unlinkSync(movieNightPath);

    console.log(`[MovieLifecycle] Movie night ended by ${endedBy}: ${currentMovie.title}`);

    return {
        success: true,
        message: `The movie night for **${currentMovie.title}** has ended.`,
        finishedMovie: currentMovie,
    };
}

export function scheduleMovieAutoEnd(startTimeISO: string, runtimeMinutes: number) {
    const bufferMinutes = 30;
    const endTime = DateTime.fromISO(startTimeISO).plus({ minutes: runtimeMinutes + bufferMinutes });
    const now = DateTime.utc();
    const msUntilEnd = endTime.diff(now).as('milliseconds');

    if (msUntilEnd <= 0) {
        console.warn("[MovieLifecycle] Movie auto-end time is in the past. Skipping.");
        return;
    }

    if (autoEndTimeout) {
        clearTimeout(autoEndTimeout)
    }

    autoEndTimeout = setTimeout(async () => {
        console.log("[MovieLifecycle] Auto-ending movie night based on runtime.");
        await finishMovieNight('auto');
    }, msUntilEnd);

    console.log(`[MovieLifecycle] Auto-end scheduled in ${Math.round(msUntilEnd / 1000)}s at ${endTime.toISO()}`);
}
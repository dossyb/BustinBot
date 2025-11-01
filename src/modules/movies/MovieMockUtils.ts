import type { Movie } from "../../models/Movie.js";

const MOCK_USER_IDS = ['user_1', 'user_2', 'user_3', 'user_4', 'user_5'];
const MOCK_USER_NAMES = ['Pitbull', 'Yuki', 'skaterbob', 'Zuk', 'Wartortor'];

export function injectMockUsers(movies: Movie[]): Movie[] {
    if (process.env.BOT_MODE !== 'dev') return movies;

    return movies.map((movie, i) => ({
        ...movie,
        addedByDisplay: `**${MOCK_USER_NAMES[i % MOCK_USER_NAMES.length]!}**`,
        addedByDevId: MOCK_USER_IDS[i % MOCK_USER_IDS.length]!,
    }));
}

export function getDisplayNameFromAddedBy(addedBy: string, addedByDisplay?: string): string {
    if (addedByDisplay) {
        return addedByDisplay;
    }

    return `<@${addedBy}>`;
}

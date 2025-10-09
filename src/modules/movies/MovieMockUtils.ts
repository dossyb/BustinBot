import type { Movie } from "../../models/Movie";

const MOCK_USER_IDS = ['user_1', 'user_2', 'user_3', 'user_4', 'user_5'];
const MOCK_USER_NAMES = ['Pitbull', 'Yuki', 'skaterbob', 'Zuk', 'Wartortor'];

export function injectMockUsers(movies: Movie[]): Movie[] {
    if (process.env.BOT_MODE !== 'dev') return movies;

    return movies.map((movie, i) => ({
        ...movie,
        addedBy: MOCK_USER_IDS[i % MOCK_USER_IDS.length]!
    }));
}

export function getDisplayNameFromAddedBy(addedBy: string): string {
    const index = MOCK_USER_IDS.indexOf(addedBy);
    if (index !== -1) {
        return `**${MOCK_USER_NAMES[index]}**`;
    }

    return `<@${addedBy}>`;
}
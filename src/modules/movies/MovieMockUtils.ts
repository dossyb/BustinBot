import type { Movie } from "../../models/Movie.js";

const MOCK_USERS = [
    { id: "user_1", name: "Pitbull" },
    { id: "user_2", name: "Yuki" },
    { id: "user_3", name: "skaterbob" },
    { id: "user_4", name: "Zuk" },
    { id: "user_5", name: "Wartortor" },
];

export function injectMockUsers(movies: Movie[]): Movie[] {
    if (process.env.BOT_MODE !== "dev") return movies;

    return movies.map((movie, i) => {
        const mockUser = MOCK_USERS[i % MOCK_USERS.length];
        if (!mockUser) return movie;
        return { ...movie, addedByDisplay: `**${mockUser.name}**`, addedByDevId: mockUser.id };
    });
}

export function getDisplayNameFromAddedBy(addedBy: string, addedByDisplay?: string): string {
    if (addedByDisplay) {
        return addedByDisplay;
    }

    return `<@${addedBy}>`;
}

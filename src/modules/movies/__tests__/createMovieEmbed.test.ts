const discordMock = vi.hoisted(() => import("../../../tests/mocks/discordMock.js"));

vi.mock("discord.js", async () => ({
    ...(await discordMock),
}));

import { createMovieEmbed } from "../MovieEmbeds.js";
import { mockEmbedInstance } from "../../../tests/mocks/discordMock.js";

describe('createMovieEmbed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call setTitle and addFields with correct data', () => {
        const movie = { title: 'Inception', runtime: 148, director: 'Christopher Nolan', rating: 9.2, genres: ['Action', 'Thriller'], cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt'] };
        const embed = createMovieEmbed(movie);

        expect(embed).toBe(mockEmbedInstance);
        expect(mockEmbedInstance.setTitle).toHaveBeenCalledWith('Inception');
        expect(mockEmbedInstance.addFields).toHaveBeenCalledWith(
            { name: 'Runtime', value: '148 mins', inline: true },
            { name: 'Director', value: 'Christopher Nolan', inline: true },
            { name: 'Rating', value: '9.2/10', inline: true },
            { name: 'Genres', value: 'Action, Thriller', inline: true },
            { name: 'Starring', value: 'Leonardo DiCaprio, Joseph Gordon-Levitt', inline: true }
        );
    });

    it('should handle missing fields gracefully', () => {
        const movie = { title: 'Unknown Film' };
        createMovieEmbed(movie);

        expect(mockEmbedInstance.addFields).toHaveBeenCalledWith(
            { name: 'Runtime', value: 'Unknown', inline: true },
            { name: 'Director', value: 'Unknown', inline: true },
            { name: 'Rating', value: 'Unrated', inline: true },
            { name: 'Genres', value: 'Unknown', inline: true },
            { name: 'Starring', value: 'Unknown', inline: true },
        );
    });
});
import { describe, expect, test } from "vitest";
import { createMovieEmbed } from "../../../../src/modules/movies/MovieEmbeds.js";

describe("createMovieEmbed", () => {
    test("fills in what TMDb doesn't know", () => {
        const embed = createMovieEmbed({ title: "Unknown Film" }).toJSON();

        expect(embed).toMatchObject({ description: "No description available.", url: "https://www.themoviedb.org/" });
        expect(embed.fields?.map((field) => field.value)).toEqual([
            "Unknown",
            "Unknown",
            "Unrated",
            "Unknown",
            "Unknown",
        ]);
    });
});

import { describe, expect, test } from "../fixtures.js";
import { chatInputInteraction, AS } from "../discord/payloads.js";

function listedCommands(description: string | undefined): string[] {
    return [...(description ?? "").matchAll(/\*\*(\/\w+)\*\*/g)].flatMap(([, name]) => (name ? [name] : []));
}

describe("/moviehelp", () => {
    test("lists the member commands for members, and the admin commands too for movie admins", async ({
        discord,
        interact,
    }) => {
        const member = await interact(chatInputInteraction("moviehelp"));
        const admin = await interact(chatInputInteraction("moviehelp", [], AS.movieAdmin));

        const commandsFor = (interaction: typeof member) =>
            listedCommands(discord.originalEdits(interaction)[0]?.embeds?.[0]?.fields?.at(-1)?.value);
        expect(commandsFor(member)).toEqual([
            "/addmovie",
            "/listmovies",
            "/viewmovie",
            "/currentmovie",
            "/removemovie",
            "/mymovies",
        ]);
        expect(commandsFor(admin)).toContain("/movienight");
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({
        discord,
        interact,
        uncachedGuild,
    }) => {
        const command = await interact(chatInputInteraction("moviehelp", [], { ...uncachedGuild, ...AS.movieAdmin }));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.at(-1)?.name).toBe(
            "Available Commands (User + Admin)",
        );
    });
});

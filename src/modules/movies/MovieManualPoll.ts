import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, Message, TextChannel } from "discord.js";
import type { RepliableInteraction } from "discord.js";
import fs from 'fs';
import path from 'path';
import type { Movie } from "../../models/Movie";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');
const PAGE_SIZE = 25;
const sessions = new Map<string, { selected: Set<string>; page: number }>();

function getPaginatedMovies(page: number, movies: Movie[]) {
    const start = page * PAGE_SIZE;
    return movies.slice(start, start + PAGE_SIZE);
}

function normalizeLabel(title: string): string {
    const t = (title || "Untitled").trim();
    return t.length >= 5 ? t.slice(0, 100) : t.padEnd(5, ".");
}


export async function showMovieManualPollMenu(interaction: RepliableInteraction) {
    if (!fs.existsSync(movieFilePath)) {
        await interaction.followUp({ content: 'Movie list not found.', flags: 1 << 6 });
        return;
    }

    const allMovies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, 'utf-8'));
    const userId = interaction.user.id;
    const session = sessions.get(userId) ?? { selected: new Set<string>(), page: 0 };
    sessions.set(userId, session);

    const pageMovies = getPaginatedMovies(session.page, allMovies);

    const options = pageMovies.map((movie) => {
        const fullIndex = allMovies.findIndex(m => m.id === movie.id);
        const indexStr = fullIndex !== -1 ? `${fullIndex + 1}. ` : '';
        const year = movie.releaseDate ? ` (${movie.releaseDate})` : '';
        return {
            label: normalizeLabel(`${indexStr}${movie.title}${year}`),
            value: movie.id,
        };
    });

    const alreadySelected = session.selected.size;
    const remaining = Math.max(0, 5 - alreadySelected);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('movie_poll_manual_select')
        .setPlaceholder(
            remaining > 0
                ? `Pick up to ${remaining} more movie${remaining > 1 ? "s" : ""}`
                : "Selection limit reached (5)"
        )
        .addOptions(options)
        .setMinValues(0)
        .setMaxValues(Math.min(remaining, options.length));

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('movie_poll_manual_prev').setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(session.page === 0),
        new ButtonBuilder().setCustomId('movie_poll_manual_next').setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled((session.page + 1) * PAGE_SIZE >= allMovies.length),
        new ButtonBuilder().setCustomId('movie_poll_manual_confirm').setLabel('Confirm').setStyle(ButtonStyle.Success).setDisabled(session.selected.size < 2),
        new ButtonBuilder().setCustomId('movie_poll_manual_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );

    const selectedTitles = allMovies
        .filter((movie) => session.selected.has(movie.id))
        .map((movie) => {
            const index = allMovies.findIndex(m => m.id === movie.id);
            const number = index !== -1 ? `${index + 1}. ` : '';
            const year = movie.releaseDate ? ` (${movie.releaseDate})` : '';
            return `• ${number}${movie.title}${year}`;
        })
        .join("\n");

    const content = [
        `Select **up to 5** movies for the poll (Page ${session.page + 1})`,
        selectedTitles
            ? `\n**Currently selected:**\n${selectedTitles}`
            : `\n_No movies selected yet._`,
    ].join("\n");

    const components = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
        controlRow,
    ];

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, components });
    } else if ('update' in interaction) {
        await interaction.update({ content, components });
    } else {
        await interaction.reply({ content, components, flags: 1 << 6 });
    }
}

export function getManualPollSession(userId: string) {
    return sessions.get(userId);
}

export function clearManualPollSession(userId: string) {
    sessions.delete(userId);
}

export function updateManualPollSelection(userId: string, selectedIds: string[]) {
    const session = sessions.get(userId);
    if (!session) return;

    // If the user is selecting on this page, merge new selections
    for (const id of selectedIds) {
        if (session.selected.size < 5) {
            session.selected.add(id);
        }
    }
}

export function changeManualPollPage(userId: string, delta: number) {
    const session = sessions.get(userId);
    if (session) {
        const allMovies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, 'utf-8'));
        const totalPages = Math.ceil(allMovies.length / PAGE_SIZE);

        session.page = Math.max(0, Math.min(session.page + delta, totalPages - 1));
    }
}

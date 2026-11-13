import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { clamp } from "es-toolkit";

export function listPage<T>(
    items: T[],
    perPage: number,
    requestedPage: number,
): { page: number; lastPage: number; items: T[] } {
    const lastPage = Math.ceil(items.length / perPage) - 1;
    const page = clamp(requestedPage, 0, lastPage);
    return { page, lastPage, items: items.slice(page * perPage, (page + 1) * perPage) };
}

export function pageButtons(prefix: string, page: number, lastPage: number): ActionRowBuilder<ButtonBuilder> {
    const button = (action: string, to: number, emoji: string, style: ButtonStyle, disabled: boolean) =>
        new ButtonBuilder()
            .setCustomId(`${prefix}${action}|${to}`)
            .setEmoji(emoji)
            .setStyle(style)
            .setDisabled(disabled);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("start", 0, "⏮️", ButtonStyle.Secondary, page === 0),
        button("prev", page - 1, "◀️", ButtonStyle.Primary, page === 0),
        button("next", page + 1, "▶️", ButtonStyle.Primary, page >= lastPage),
        button("end", lastPage, "⏭️", ButtonStyle.Secondary, page >= lastPage),
    );
}

export function buttonPage(customId: string): number {
    return Number(customId.split("|").at(-1)) || 0;
}

import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { DateTime, IANAZone } from "luxon";
import Fuse from "fuse.js";

export function createTimezoneModal() {
    const modal = new ModalBuilder()
        .setCustomId('setup_timezone_modal')
        .setTitle('Set Guild Timezone');

    const tzInput = new TextInputBuilder()
        .setCustomId('timezone_input')
        .setLabel('Enter timezone (e.g. "Australia/Melbourne")')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type a city or IANA name...')
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(tzInput)
    );

    return modal;
}

export class TimezoneService {
    private fuse: Fuse<string>;
    private allZones: string[];

    constructor() {
        this.allZones =
            typeof Intl.supportedValuesOf === 'function'
                ? Intl.supportedValuesOf('timeZone')
                : this.getFallbackZones();

        this.fuse = new Fuse(this.allZones, {
            threshold: 0.4,
            includeScore: true,
        });
    }

    public fuzzyMatch(input: string): string | null {
        if (!input) return null;

        const results = this.fuse.search(input.trim());
        const best = results[0]?.item;

        if (!best) return null;

        if (IANAZone.isValidZone(best)) return best;

        return null;
    }

    public validate(zone: string): boolean {
        return !!zone && IANAZone.isValidZone(zone);
    }

    public getCurrentTimeInZone(zone: string): string {
        const dt = DateTime.now().setZone(zone);
        return dt.isValid ? dt.toFormat("fff") : 'Invalid zone';
    }

    private getFallbackZones(): string[] {
        return [
            "UTC",
            "Australia/Melbourne",
            "Australia/Sydney",
            "America/New_York",
            "America/Los_Angeles",
            "Europe/London",
            "Europe/Paris",
            "Asia/Tokyo",
            "Asia/Singapore",
        ];
    }
}

export const timezoneService = new TimezoneService();

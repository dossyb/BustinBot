import {
    SlashCommandBuilder,
    MessageFlags,
    ComponentType,
    type APIMessageTopLevelComponent,
    type APISectionComponent,
    type APITextDisplayComponent,
    type MessageCreateOptions,
} from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import fs from "fs";
import path from "path";
import { packageVersion } from "../../../utils/version.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../../utils/MentionUtils.js";
import { configuredChannel } from "../../../utils/ChannelUtils.js";

interface Announcement {
    title: string;
    intro: string;
    sections: { name: string; value: string }[];
    footer?: string;
}

function buildSection(
    content: string | string[],
    accessoryUrl?: string
): APIMessageTopLevelComponent[] {
    const textArray = Array.isArray(content) ? content : [content];

    if (accessoryUrl) {
        const section: APISectionComponent = {
            type: ComponentType.Section,
            components: textArray.map<APITextDisplayComponent>((text) => ({
                type: ComponentType.TextDisplay,
                content: text,
            })),
            accessory: {
                type: ComponentType.Thumbnail,
                media: {
                    url: accessoryUrl,
                },
            },
        };
        return [section];
    }

    return textArray.map<APITextDisplayComponent>((text) => ({
        type: ComponentType.TextDisplay,
        content: text,
    }));
}

function buildDivider(): APIMessageTopLevelComponent {
    return {
        type: ComponentType.Separator,
        divider: true,
    };
}

const announce: Command = {
    name: "announce",
    description: "Post the latest BustinBot version announcement.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Post the latest BustinBot version announcement."),

    async execute({ interaction, services }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const announcementsPath = path.join(import.meta.dirname, "../../../../data/announcements.json");
        if (!fs.existsSync(announcementsPath)) {
            await interaction.editReply({
                content: "announcements.json not found.",
            });
            return;
        }

        const data = JSON.parse(fs.readFileSync(announcementsPath, "utf8"));
        const currentVersion = packageVersion;
        const announcement: Announcement | undefined = data[currentVersion];

        if (!announcement) {
            await interaction.editReply({
                content: `No announcement found for version **${currentVersion}**.`,
            });
            return;
        }

        // Get announcement channel
        const channel = await configuredChannel(interaction.client, services, "announcements");
        if (!channel) {
            const channelId = (await services.guilds.get(services.guildId))?.channels?.announcements;
            await interaction.editReply({
                content: channelId
                    ? `I can't reach the announcement channel <#${channelId}>. Check it still exists and that I can see it, or pick another with \`/setup\`.`
                    : "Announcement channel not configured. Please run `/setup` first.",
            });
            return;
        }

        // Build sections
        const botUser = interaction.client.user;
        const avatarUrl = botUser?.displayAvatarURL({ size: 512 }) ?? "";

        const sectionHeader = buildSection(announcement.title, avatarUrl);
        const sectionIntro = buildSection(announcement.intro);
        const featureSections = announcement.sections.flatMap((sec) =>
            buildSection([`**${sec.name}**`, sec.value])
        );

        const components: APIMessageTopLevelComponent[] = [
            ...sectionHeader,
            ...sectionIntro,
            buildDivider(),
            ...featureSections,
        ];

        const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);

        // Send announcement
        await channel.send(withSuppressedMentions<MessageCreateOptions>({
            flags: MessageFlags.IsComponentsV2,
            components,
        }, suppressMentions));

        await interaction.editReply({
            content: `Announcement for **v${currentVersion}** posted in <#${channel.id}>.`,
        });
    },
};

export default announce;

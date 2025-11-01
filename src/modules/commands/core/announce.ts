import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    ComponentType,
    type APIMessageTopLevelComponent,
    type APISectionComponent,
    type APITextDisplayComponent,
} from "discord.js";
import type { Command } from "models/Command";
import { CommandModule, CommandRole } from "models/Command";
import { version } from "../../../../package.json";
import fs from "fs";
import path, { dirname } from "path";
import type { ServiceContainer } from "core/services/ServiceContainer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

    async execute({ interaction, services, }: { interaction?: ChatInputCommandInteraction, services?: ServiceContainer; }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const announcementsPath = path.join(__dirname, "../../../data/announcements.json");
        if (!fs.existsSync(announcementsPath)) {
            await interaction.editReply({
                content: "announcements.json not found.",
            });
            return;
        }

        const data = JSON.parse(fs.readFileSync(announcementsPath, "utf8"));
        const currentVersion = version;
        const announcement: Announcement | undefined = data[currentVersion];

        if (!announcement) {
            await interaction.editReply({
                content: `No announcement found for version **${currentVersion}**.`,
            });
            return;
        }

        // Get announcement channel
        const guildConfig = await services?.guilds.requireConfig(interaction);
        const channelId = guildConfig?.channels?.announcements;
        if (!channelId) {
            await interaction.editReply({
                content: "Announcement channel not configured. Please run `/setup` first.",
            });
            return;
        }

        const fetchedChannel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!fetchedChannel || !fetchedChannel.isTextBased()) {
            await interaction.editReply({ content: "Announcement channel not configured. Please run `/setup` first."});
            return;
        }
        const channel = fetchedChannel;

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

        // Send announcement
        await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components,
        });

        await interaction.editReply({
            content: `Announcement for **v${currentVersion}** posted in <#${channelId}>.`,
        });
    },
};

export default announce;

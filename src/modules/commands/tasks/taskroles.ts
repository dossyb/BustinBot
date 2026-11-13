import { SlashCommandBuilder, EmbedBuilder, type Role, type Guild as DiscordGuild, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import type { Guild as GuildConfig, GuildRoles } from "../../../models/Guild.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { getHighestMilestone, getTotalTaskCompletions, resolveMilestones } from "../../tasks/TaskMilestones.js";

const ROLE_ID_MATCH = /^(?:<@&(\d+)>|(\d{17,}))$/;
// TODO: Confirm the neutral milestone role color preference.
const NEUTRAL_ROLE_COLOR = 0x95a5a6;
// TODO: Confirm champion role colors match desired palette.
const CHAMPION_ROLE_COLORS = {
    first: 0xffd700,
    second: 0xc0c0c0,
    third: 0xcd7f32,
} as const;

function resolveRoleByInput(
    guild: DiscordGuild,
    input: string
): { role: Role | null; isIdLookup: boolean; error?: string } {
    const trimmed = input.trim();
    const idMatch = trimmed.match(ROLE_ID_MATCH);
    if (idMatch) {
        const id = idMatch[1] ?? idMatch[2];
        return { role: id ? guild.roles.cache.get(id) ?? null : null, isIdLookup: true };
    }

    const matches = guild.roles.cache.filter(
        (role) => role.name.toLowerCase() === trimmed.toLowerCase()
    );

    if (matches.size > 1) {
        return {
            role: null,
            isIdLookup: false,
            error: `Multiple roles match "${trimmed}". Please use a role mention or ID.`,
        };
    }

    return { role: matches.first() ?? null, isIdLookup: false };
}

function resolveChampionField(value: number): { key: "taskChampionFirst" | "taskChampionSecond" | "taskChampionThird"; label: string } | null {
    if (value === 1) return { key: "taskChampionFirst", label: "1st" };
    if (value === 2) return { key: "taskChampionSecond", label: "2nd" };
    if (value === 3) return { key: "taskChampionThird", label: "3rd" };
    return null;
}

function resolveChampionPlacement(roleId: string | undefined, roles: GuildConfig["roles"] | undefined) {
    if (!roleId || !roles) return null;
    if (roles.taskChampionFirst === roleId) return { key: "taskChampionFirst", label: "1st", value: 1 };
    if (roles.taskChampionSecond === roleId) return { key: "taskChampionSecond", label: "2nd", value: 2 };
    if (roles.taskChampionThird === roleId) return { key: "taskChampionThird", label: "3rd", value: 3 };
    return null;
}

const taskroles: Command = {
    name: "taskroles",
    description: "Manage task milestone and champion roles.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName("taskroles")
        .setDescription("Manage task milestone and champion roles.")
        .addSubcommand((sub) =>
            sub.setName("list").setDescription("List task roles.")
        )
        .addSubcommand((sub) =>
            sub
                .setName("add")
                .setDescription("Add a task role.")
                .addStringOption((opt) =>
                    opt.setName("role").setDescription("Role name or ID (mention also works).").setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName("type")
                        .setDescription("Role type.")
                        .setRequired(true)
                        .addChoices(
                            { name: "Milestone", value: "milestone" },
                            { name: "Champion", value: "champion" }
                        )
                )
                .addIntegerOption((opt) =>
                    opt
                        .setName("value")
                        .setDescription("Milestone threshold or champion placement (1-3).")
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("edit")
                .setDescription("Edit an existing task role.")
                .addStringOption((opt) =>
                    opt.setName("role").setDescription("Existing role name or ID.").setRequired(true)
                )
                .addStringOption((opt) =>
                    opt.setName("newrole").setDescription("New role name or ID.").setRequired(true)
                )
                .addIntegerOption((opt) =>
                    opt
                        .setName("value")
                        .setDescription("Milestone threshold or champion placement (1-3).")
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("delete")
                .setDescription("Delete a task role.")
                .addStringOption((opt) =>
                    opt.setName("role").setDescription("Role name or ID.").setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("toggle")
                .setDescription("Enable or disable all roles of a type.")
                .addStringOption((opt) =>
                    opt
                        .setName("type")
                        .setDescription("Role type.")
                        .setRequired(true)
                        .addChoices(
                            { name: "Milestone", value: "milestone" },
                            { name: "Champion", value: "champion" }
                        )
                )
                .addBooleanOption((opt) =>
                    opt.setName("enabled").setDescription("Whether the role type is active.").setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("grant")
                .setDescription("Grant a role to a user.")
                .addUserOption((opt) =>
                    opt.setName("user").setDescription("User to grant the role to.").setRequired(true)
                )
                .addRoleOption((opt) =>
                    opt.setName("role").setDescription("Role to grant.").setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("init")
                .setDescription("Sync task roles with server roles and grant them to eligible users.")
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;
        const guildConfig = await services.guilds.get(guildId);

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({ content: "Guild not found for this interaction." });
            return;
        }

        await guild.roles.fetch();

        const sub = interaction.options.getSubcommand();
        const current = resolveMilestones(guildConfig?.taskSettings?.milestoneRoles).slice();
        const championSettings = {
            first: true,
            second: true,
            third: true,
            ...(guildConfig?.taskSettings?.championRoles ?? {}),
        };
        const milestoneEnabled = current.length === 0 ? true : current.every((milestone) => milestone.enabled);
        const championEnabled = championSettings.first && championSettings.second && championSettings.third;

        if (sub === "list") {
            const milestoneLines =
                current.length > 0
                    ? current.map((milestone) => {
                          const roleName = milestone.roleId
                              ? guild.roles.cache.get(milestone.roleId)?.name ?? milestone.label
                              : milestone.label;
                          return `- ${roleName} — ${milestone.requiredSubmissions} submissions`;
                      })
                    : ["No milestone roles configured."];

            const championRoles = [
                { label: "1st", roleId: guildConfig?.roles?.taskChampionFirst },
                { label: "2nd", roleId: guildConfig?.roles?.taskChampionSecond },
                { label: "3rd", roleId: guildConfig?.roles?.taskChampionThird },
            ].map((entry) => {
                const roleName = entry.roleId ? guild.roles.cache.get(entry.roleId)?.name ?? "Missing role" : "Not set";
                return `- ${entry.label} — ${roleName}`;
            });

            const embed = new EmbedBuilder()
                .setTitle("Task Roles")
                .setColor(0xa60000)
                .setDescription(
                    [
                        `**Milestone Roles** (${milestoneEnabled ? "Enabled" : "Disabled"})`,
                        ...milestoneLines,
                        "",
                        `**Champion Roles** (${championEnabled ? "Enabled" : "Disabled"})`,
                        ...championRoles,
                    ].join("\n")
                );

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (sub === "add") {
            const roleInput = interaction.options.getString("role", true);
            const type = interaction.options.getString("type", true);
            const value = interaction.options.getInteger("value", true);

            if (type === "milestone" && value <= 0) {
                await interaction.editReply({ content: "Milestone thresholds must be greater than 0." });
                return;
            }
            const championField = type === "champion" ? resolveChampionField(value) : null;
            if (type === "champion" && !championField) {
                await interaction.editReply({ content: "Champion placement must be 1, 2, or 3." });
                return;
            }

            const resolved = resolveRoleByInput(guild, roleInput);
            if (resolved.error) {
                await interaction.editReply({ content: resolved.error });
                return;
            }

            let role = resolved.role;
            if (!role) {
                if (resolved.isIdLookup) {
                    await interaction.editReply({ content: "Role not found for the provided ID/mention." });
                    return;
                }
                try {
                    role = await guild.roles.create({ name: roleInput.trim() });
                } catch (err) {
                    console.warn("[TaskRoles] Failed to create role:", err);
                    await interaction.editReply({ content: "Failed to create the role. Check bot permissions." });
                    return;
                }
            }

            if (!championField) {
                if (current.some((item) => item.roleId === role.id)) {
                    await interaction.editReply({ content: "That role is already configured as a milestone." });
                    return;
                }

                const placeholderIndex = current.findIndex(
                    (item) => !item.roleId && item.label.toLowerCase() === role.name.toLowerCase()
                );
                const placeholder = current[placeholderIndex];

                if (placeholder) {
                    current[placeholderIndex] = {
                        ...placeholder,
                        id: role.id,
                        label: role.name,
                        roleId: role.id,
                        requiredSubmissions: value,
                        enabled: milestoneEnabled,
                    };
                } else {
                    current.push({
                        id: role.id,
                        label: role.name,
                        roleId: role.id,
                        requiredSubmissions: value,
                        enabled: milestoneEnabled,
                    });
                }

                await services.guilds.update(guildId, { taskSettings: { milestoneRoles: current } });
                await interaction.editReply({ content: `Added milestone role **${role.name}** (${value}).` });
                return;
            }

            await services.guilds.update(guildId, { roles: { [championField.key]: role.id } });

            await interaction.editReply({
                content: `Set ${championField.label} place champion role to **${role.name}**.`,
            });
            return;
        }

        if (sub === "edit") {
            const roleInput = interaction.options.getString("role", true);
            const newRoleInput = interaction.options.getString("newrole", true);
            const value = interaction.options.getInteger("value", true);

            const resolved = resolveRoleByInput(guild, roleInput);
            if (resolved.error) {
                await interaction.editReply({ content: resolved.error });
                return;
            }
            const role = resolved.role;
            if (!role) {
                await interaction.editReply({ content: "Role not found for the provided input." });
                return;
            }

            const milestoneIndex = current.findIndex(
                (item) =>
                    item.roleId === role.id ||
                    (!item.roleId && item.label.toLowerCase() === role.name.toLowerCase())
            );
            const milestone = current[milestoneIndex];
            const championPlacement = resolveChampionPlacement(role.id, guildConfig?.roles);

            if (milestone && championPlacement) {
                await interaction.editReply({ content: "That role is configured as both milestone and champion. Please resolve manually." });
                return;
            }

            if (!milestone && !championPlacement) {
                await interaction.editReply({ content: "That role is not configured as a task role." });
                return;
            }

            if (milestone) {
                if (value <= 0) {
                    await interaction.editReply({ content: "Milestone thresholds must be greater than 0." });
                    return;
                }

                let targetRole = role;
                const newRoleResolution = resolveRoleByInput(guild, newRoleInput);
                if (newRoleResolution.error) {
                    await interaction.editReply({ content: newRoleResolution.error });
                    return;
                }
                if (newRoleResolution.isIdLookup) {
                    if (!newRoleResolution.role) {
                        await interaction.editReply({ content: "New role not found for the provided ID/mention." });
                        return;
                    }
                    if (newRoleResolution.role.id !== role.id) {
                        targetRole = newRoleResolution.role;
                    }
                } else if (newRoleInput.trim() && newRoleInput.trim() !== role.name) {
                    try {
                        targetRole = await role.setName(newRoleInput.trim());
                    } catch (err) {
                        console.warn("[TaskRoles] Failed to rename role:", err);
                        await interaction.editReply({ content: "Failed to rename the role. Check bot permissions." });
                        return;
                    }
                }

                current[milestoneIndex] = {
                    ...milestone,
                    id: targetRole.id,
                    label: targetRole.name,
                    roleId: targetRole.id,
                    requiredSubmissions: value,
                };

                await services.guilds.update(guildId, { taskSettings: { milestoneRoles: current } });
                await interaction.editReply({ content: `Updated milestone role **${targetRole.name}** (${value}).` });
                return;
            }

            const championField = resolveChampionField(value);
            if (!championField) {
                await interaction.editReply({ content: "Champion placement must be 1, 2, or 3." });
                return;
            }

            let targetRole = role;
            const newRoleResolution = resolveRoleByInput(guild, newRoleInput);
            if (newRoleResolution.error) {
                await interaction.editReply({ content: newRoleResolution.error });
                return;
            }
            if (newRoleResolution.isIdLookup) {
                if (!newRoleResolution.role) {
                    await interaction.editReply({ content: "New role not found for the provided ID/mention." });
                    return;
                }
                if (newRoleResolution.role.id !== role.id) {
                    targetRole = newRoleResolution.role;
                }
            } else if (newRoleInput.trim() && newRoleInput.trim() !== role.name) {
                try {
                    targetRole = await role.setName(newRoleInput.trim());
                } catch (err) {
                    console.warn("[TaskRoles] Failed to rename role:", err);
                    await interaction.editReply({ content: "Failed to rename the role. Check bot permissions." });
                    return;
                }
            }

            await services.guilds.update(guildId, {
                roles: {
                    ...(championPlacement && championPlacement.key !== championField.key && { [championPlacement.key]: "" }),
                    [championField.key]: targetRole.id,
                },
            });
            await interaction.editReply({
                content: `Updated champion role **${targetRole.name}** to ${championField.label} place.`,
            });
            return;
        }

        if (sub === "delete") {
            const roleInput = interaction.options.getString("role", true);
            const resolved = resolveRoleByInput(guild, roleInput);
            if (resolved.error) {
                await interaction.editReply({ content: resolved.error });
                return;
            }

            const role = resolved.role;
            if (!role) {
                await interaction.editReply({ content: "Role not found for the provided input." });
                return;
            }

            const milestoneIndex = current.findIndex(
                (item) =>
                    item.roleId === role.id ||
                    (!item.roleId && item.label.toLowerCase() === role.name.toLowerCase())
            );
            const championPlacement = resolveChampionPlacement(role.id, guildConfig?.roles);

            if (milestoneIndex !== -1 && championPlacement) {
                await interaction.editReply({ content: "That role is configured as both milestone and champion. Please resolve manually." });
                return;
            }

            let described: string;
            let reason: string;
            if (milestoneIndex !== -1) {
                const label = current.splice(milestoneIndex, 1)[0]?.label ?? role.name;
                await services.guilds.update(guildId, { taskSettings: { milestoneRoles: current } });
                described = `milestone role **${label}**`;
                reason = `Removed task milestone role ${label}`;
            } else if (championPlacement) {
                await services.guilds.update(guildId, { roles: { [championPlacement.key]: "" } });
                described = `champion role **${role.name}** (${championPlacement.label})`;
                reason = `Removed task champion role ${role.name}`;
            } else {
                await interaction.editReply({ content: "That role is not configured as a task role." });
                return;
            }

            let deleted = true;
            try {
                await role.delete(reason);
            } catch (err) {
                console.warn("[TaskRoles] Failed to delete task role:", err);
                deleted = false;
            }
            await interaction.editReply({
                content: deleted
                    ? `Deleted ${described}.`
                    : `Removed ${described}. It is no longer a task role, but I couldn't delete it from the server. Check my permissions, or delete it yourself.`,
            });
            return;
        }

        if (sub === "toggle") {
            const type = interaction.options.getString("type", true);
            const enabled = interaction.options.getBoolean("enabled", true);

            if (type === "milestone") {
                const updated = current.map((milestone) => ({ ...milestone, enabled }));
                await services.guilds.update(guildId, { taskSettings: { milestoneRoles: updated } });
                await interaction.editReply({
                    content: `${enabled ? "Enabled" : "Disabled"} milestone roles.`,
                });
                return;
            }

            const updatedChampionSettings = {
                first: enabled,
                second: enabled,
                third: enabled,
            };

            await services.guilds.update(guildId, { taskSettings: { championRoles: updatedChampionSettings } });

            if (!enabled) {
                try {
                    const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
                    const champions = leaderboard?.champions;
                    const removalTargets = [
                        { roleId: guildConfig?.roles?.taskChampionFirst, userIds: champions?.first ?? [] },
                        { roleId: guildConfig?.roles?.taskChampionSecond, userIds: champions?.second ?? [] },
                        { roleId: guildConfig?.roles?.taskChampionThird, userIds: champions?.third ?? [] },
                    ];

                    for (const target of removalTargets) {
                        if (!target.roleId) continue;
                        for (const userId of target.userIds) {
                            try {
                                const member = await guild.members.fetch(userId);
                                if (member.roles.cache.has(target.roleId)) {
                                    await member.roles.remove(target.roleId);
                                }
                            } catch (err) {
                                console.warn(`[TaskRoles] Failed to remove champion role from ${userId}:`, err);
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[TaskRoles] Failed to resolve champion role holders for removal:", err);
                }
            }

            await interaction.editReply({
                content: `${enabled ? "Enabled" : "Disabled"} champion roles.`,
            });
            return;
        }

        if (sub === "grant") {
            const user = interaction.options.getUser("user", true);
            const role = interaction.options.getRole("role", true);

            try {
                const member = await guild.members.fetch(user.id);
                await member.roles.add(role.id);
                await interaction.editReply({
                    content: `Granted **${role.name}** to ${user.tag}.`,
                });
            } catch (err) {
                console.warn("[TaskRoles] Failed to grant role:", err);
                await interaction.editReply({ content: "Failed to grant the role. Check bot permissions." });
            }
            return;
        }

        if (sub === "init") {
            const respond = async (content: string) => {
                await interaction.editReply({ content });
            };

            const userRepo = services.repos.userRepo;

            const updates: Partial<GuildConfig> = {};
            const updatedMilestones = current.map((milestone) => ({ ...milestone }));
            let milestoneChanged = false;
            let rolesChanged = false;

            for (const milestone of updatedMilestones) {
                const desiredName = milestone.label;
                let role = milestone.roleId ? guild.roles.cache.get(milestone.roleId) ?? null : null;

                if (!role) {
                    const matches = guild.roles.cache.filter(
                        (candidate) => candidate.name.toLowerCase() === desiredName.toLowerCase()
                    );
                    role = matches.first() ?? null;
                }

                if (!role) {
                    try {
                        role = await guild.roles.create({ name: desiredName, colors: { primaryColor: NEUTRAL_ROLE_COLOR } });
                    } catch (err) {
                        console.warn("[TaskRoles] Failed to create milestone role:", err);
                        continue;
                    }
                } else if (role.colors.primaryColor !== NEUTRAL_ROLE_COLOR) {
                    try {
                        await role.setColors({ primaryColor: NEUTRAL_ROLE_COLOR });
                    } catch (err) {
                        console.warn("[TaskRoles] Failed to update milestone role color:", err);
                    }
                }

                if (milestone.roleId !== role.id || milestone.id !== role.id || milestone.label !== role.name) {
                    milestone.roleId = role.id;
                    milestone.id = role.id;
                    milestone.label = role.name;
                    milestoneChanged = true;
                }
            }

            if (milestoneChanged) {
                updates.taskSettings = {
                    ...(updates.taskSettings ?? {}),
                    milestoneRoles: updatedMilestones,
                };
            }

            const championDefinitions = [
                { key: "taskChampionFirst", label: "Task Champion (1st)", color: CHAMPION_ROLE_COLORS.first },
                { key: "taskChampionSecond", label: "Task Champion (2nd)", color: CHAMPION_ROLE_COLORS.second },
                { key: "taskChampionThird", label: "Task Champion (3rd)", color: CHAMPION_ROLE_COLORS.third },
            ] as const;

            const roleUpdates: GuildRoles = {};
            for (const definition of championDefinitions) {
                const configuredId = guildConfig?.roles?.[definition.key];
                let role = configuredId ? guild.roles.cache.get(configuredId) ?? null : null;

                if (!role) {
                    const matches = guild.roles.cache.filter(
                        (candidate) => candidate.name.toLowerCase() === definition.label.toLowerCase()
                    );
                    role = matches.first() ?? null;
                }

                if (!role) {
                    try {
                        role = await guild.roles.create({ name: definition.label, colors: { primaryColor: definition.color } });
                    } catch (err) {
                        console.warn("[TaskRoles] Failed to create champion role:", err);
                        continue;
                    }
                } else if (role.colors.primaryColor !== definition.color) {
                    try {
                        await role.setColors({ primaryColor: definition.color });
                    } catch (err) {
                        console.warn("[TaskRoles] Failed to update champion role color:", err);
                    }
                }

                if (role && configuredId !== role.id) {
                    roleUpdates[definition.key] = role.id;
                    rolesChanged = true;
                }
            }

            if (rolesChanged) {
                updates.roles = {
                    ...(updates.roles ?? {}),
                    ...roleUpdates,
                };
            }

            if (milestoneChanged || rolesChanged) {
                await services.guilds.update(guildId, updates);
            }

            const milestoneRoles = resolveMilestones(
                (milestoneChanged ? updatedMilestones : current).slice()
            ).sort((a, b) => a.requiredSubmissions - b.requiredSubmissions);

            if (milestoneEnabled && milestoneRoles.length > 0) {
                const users = await userRepo.getAllUsers();
                for (const stats of users) {
                    const total = getTotalTaskCompletions(stats);
                    const highest = getHighestMilestone(milestoneRoles, total);
                    if (!highest?.roleId) continue;

                    try {
                        const member = await guild.members.fetch(stats.userId);
                        const shouldRoleId = highest.roleId;
                        const shouldHave = member.roles.cache.has(shouldRoleId);
                        if (!shouldHave) {
                            await member.roles.add(shouldRoleId);
                        }

                        for (const milestone of milestoneRoles) {
                            if (milestone.roleId && milestone.roleId !== shouldRoleId) {
                                if (member.roles.cache.has(milestone.roleId)) {
                                    await member.roles.remove(milestone.roleId);
                                }
                            }
                        }
                    } catch (err) {
                        if ((err as { code?: number }).code === 10007) {
                            continue;
                        }
                        console.warn(`[TaskRoles] Failed to grant milestone roles for ${stats.userId}:`, err);
                    }
                }
            }

            const championRoleIds = {
                first: roleUpdates.taskChampionFirst ?? guildConfig?.roles?.taskChampionFirst,
                second: roleUpdates.taskChampionSecond ?? guildConfig?.roles?.taskChampionSecond,
                third: roleUpdates.taskChampionThird ?? guildConfig?.roles?.taskChampionThird,
            };

            if (!championEnabled) {
                const removalTargets = [
                    championRoleIds.first,
                    championRoleIds.second,
                    championRoleIds.third,
                ];
                for (const roleId of removalTargets) {
                    if (!roleId) continue;
                    const role = guild.roles.cache.get(roleId);
                    if (!role) continue;
                    for (const member of role.members.values()) {
                        try {
                            await member.roles.remove(roleId);
                        } catch (err) {
                            console.warn(`[TaskRoles] Failed to remove champion role from ${member.id}:`, err);
                        }
                    }
                }
            } else {
                const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
                const champions = leaderboard?.champions ?? {};
                const championAssignments = [
                    { roleId: championRoleIds.first, userIds: champions.first ?? [] },
                    { roleId: championRoleIds.second, userIds: champions.second ?? [] },
                    { roleId: championRoleIds.third, userIds: champions.third ?? [] },
                ];

                for (const assignment of championAssignments) {
                    if (!assignment.roleId) continue;
                    const role = guild.roles.cache.get(assignment.roleId);
                    if (!role) continue;
                    const eligible = new Set(assignment.userIds);
                    for (const userId of assignment.userIds) {
                        try {
                            const member = await guild.members.fetch(userId);
                            if (!member.roles.cache.has(assignment.roleId)) {
                                await member.roles.add(assignment.roleId);
                            }
                        } catch (err) {
                            console.warn(`[TaskRoles] Failed to grant champion role to ${userId}:`, err);
                        }
                    }

                    for (const member of role.members.values()) {
                        if (eligible.has(member.id)) continue;
                        try {
                            await member.roles.remove(assignment.roleId);
                        } catch (err) {
                            console.warn(`[TaskRoles] Failed to remove champion role from ${member.id}:`, err);
                        }
                    }
                }
            }

            await respond("Task roles synced and granted to eligible users.");
            return;
        }

        await interaction.editReply({ content: "Unknown taskroles option." });
    }
};

export default taskroles;

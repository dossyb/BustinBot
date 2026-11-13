import { GuildMember, type Interaction } from "discord.js";

export function memberRoleIds(member: Interaction["member"]): string[] {
    if (member instanceof GuildMember) return [...member.roles.cache.keys()];
    return member?.roles ?? [];
}

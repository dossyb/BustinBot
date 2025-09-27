import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";

const bustin: Command = {
    name: 'bustin',
    description: 'Ping the bot to see if it is responsive.',
    allowedRoles: [ CommandRole.Everyone ],
    async execute({ message, interaction }) {
        if (message) await message.reply('Bustin makes me feel good!');
        else if (interaction) await interaction.reply('Bustin makes me feel good!');
    },
};

export default bustin;
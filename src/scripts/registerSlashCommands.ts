import path from 'path';
import { registerSlashCommands } from '../utils/registerCommands';
import { getFilename, getDirname } from 'utils/PathUtils';
const __dirname = getDirname(import.meta.url);

try {
    await registerSlashCommands({
        modulesDir: path.join(__dirname, '..', 'modules', 'commands'),
    });
    console.log('✅ Slash command registration complete.');
    process.exit(0);
} catch (err) {
    console.error('Failed to register slash commands:', err);
    process.exit(1);
}

import path from 'path';
import { fileURLToPath } from 'url';
import { registerSlashCommands } from '../utils/registerCommands';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

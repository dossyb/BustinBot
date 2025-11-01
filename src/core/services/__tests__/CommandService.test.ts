import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'commands-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Ensure the module command map is reset for subsequent tests
    vi.resetModules();
});

async function loadCommandModule() {
    const module = await import('../CommandService.js');
    return module.loadCommands;
}

function writeCommand(relativePath: string, contents: string) {
    const fullPath = path.join(tempDir, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents, 'utf8');
    return fullPath;
}

describe('loadCommands', () => {
    it('recursively loads command modules and registers aliases', async () => {
        writeCommand('foo.js', `
            export default {
                name: 'foo',
                description: 'Foo command',
                aliases: ['f'],
                slashData: { toJSON: () => ({ name: 'foo' }) },
                execute() {}
            };
        `);

        writeCommand('nested/bar.js', `
            export default {
                name: 'bar',
                description: 'Bar command',
                execute() {}
            };
        `);

        // Invalid command should be skipped
        writeCommand('invalid.js', `
            export default {};
        `);

        // Files under __tests__ should be ignored
        writeCommand('__tests__/ignored.js', `
            export default {
                name: 'ignored',
                execute() {}
            };
        `);

        const loadCommands = await loadCommandModule();
        const commands = await loadCommands(tempDir);

        expect(commands.get('foo')).toEqual(expect.objectContaining({ name: 'foo' }));
        expect(commands.get('f')).toBe(commands.get('foo'));
        expect(commands.get('bar')).toEqual(expect.objectContaining({ name: 'bar' }));

        expect(commands.has('ignored')).toBe(false);
        expect(commands.has('invalid')).toBe(false);
    });
});

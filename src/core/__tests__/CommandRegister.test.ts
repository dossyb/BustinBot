import path from 'path';
import { loadCommands } from '../services/CommandService';

vi.mock('../services/CommandService', () => ({
  loadCommands: vi.fn(async () => {
    const fakeCommand = {
      name: 'fake',
      slashData: { toJSON: () => ({ name: 'fake' }) },
    };
    return new Map([
      ['fake', fakeCommand],
      ['alias', fakeCommand],
    ]);
  }),
}));

vi.mock('node-fetch', () => ({
  __esModule: true,
  default: vi.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })),
}));

describe('Slash command registration', () => {
  it('invokes application.commands.create for every slash command builder', async () => {
    const commandsDir = path.join(__dirname, '../../modules/commands');
    const commandMap = await loadCommands(commandsDir);

    const uniqueCommands = Array.from(new Set(commandMap.values()));

    const create = vi.fn().mockResolvedValue(undefined);
    const client: any = { application: { commands: { create } } };

    let expectedCalls = 0;

    for (const command of uniqueCommands) {
      if (!command?.slashData) continue;
      expectedCalls += 1;
      const payload = command.slashData.toJSON();
      await expect(client.application.commands.create(payload)).resolves.toBeUndefined();
    }

    expect(create).toHaveBeenCalledTimes(expectedCalls);
  });
});

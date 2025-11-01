import { describe, it, expect, vi, beforeEach } from "vitest";
import { GuildRepository } from "../database/GuildRepo.js";
import { initTaskScheduler } from "../../modules/tasks/TaskScheduler.js";

vi.mock("../database/GuildRepo", () => ({
  GuildRepository: vi.fn().mockImplementation(() => ({
    getAllGuilds: vi.fn(),
  })),
}));

vi.mock("../../../src/modules/tasks/TaskScheduler", () => ({
  initTaskScheduler: vi.fn(),
}));

describe("Startup Scheduler Initialization", () => {
  let guildRepo: any;
  const fakeClient = { user: { tag: "BustinBot#0001" } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    guildRepo = new GuildRepository();
  });

  it("starts schedulers only for enabled guilds", async () => {
    guildRepo.getAllGuilds.mockResolvedValue([
      { id: "g1", toggles: { taskScheduler: true } },
      { id: "g2", toggles: { taskScheduler: false } },
    ]);

    const guilds = await guildRepo.getAllGuilds();

    for (const guild of guilds) {
      if (guild.toggles?.taskScheduler) {
        await initTaskScheduler(fakeClient, guild);
      }
    }

    expect(initTaskScheduler).toHaveBeenCalledTimes(1);
    expect(initTaskScheduler).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ id: "g1" }));
  });
});

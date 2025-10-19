import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";

// 🧩 Lazy imports are critical for fake timers to intercept setTimeout()
let pollMovieWithList: any;
let handleMoviePollVote: any;
let scheduleMovieReminders: any;
let scheduleActivePollClosure: any;
let removemovie: any;

// --- Mock MovieLifecycle ---
vi.mock("../../movies/MovieLifecycle", () => ({
  scheduleMovieAutoEnd: vi.fn(),
}));

// --- Mock MoviePolls (partial, preserving actual implementations) ---
vi.mock("../../movies/MoviePolls", async (importOriginal: () => Promise<any>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    closeActiveMoviePoll: vi.fn().mockResolvedValue({
      success: true,
      message: "closed poll",
      winner: { runtime: 120 },
    }),
  };
});

// --- Mock MovieEmbeds (returns real EmbedBuilder instances) ---
vi.mock("../../movies/MovieEmbeds", async (importOriginal: () => Promise<any>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createMovieEmbed: vi.fn(() => new EmbedBuilder()),
    createLocalMoviePreviewEmbed: vi.fn(() => new EmbedBuilder()),
  };
});

describe("Movie module flows", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    process.env.DISCORD_GUILD_ID = "guild-1";
    process.env.MOVIE_USER_ROLE_NAME = "Movie Fans";
    process.env.MOVIE_VOICE_CHANNEL_ID = "voice-123";

    // 👇 Lazy import ensures modules see fake timers
    vi.resetModules();
    pollMovieWithList = (await import("../../movies/MoviePolls")).pollMovieWithList;
    handleMoviePollVote = (await import("../../movies/PickMovieInteractions")).handleMoviePollVote;
    scheduleMovieReminders = (await import("../../movies/MovieReminders")).scheduleMovieReminders;
    scheduleActivePollClosure = (await import("../../movies/MoviePollScheduler")).scheduleActivePollClosure;
    removemovie = (await import("../../commands/movies/removemovie")).default;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // 🎬 Create Movie Poll / Voting
  // ------------------------------------------------------------------
  describe("createMoviePoll / voting", () => {
    function buildInteraction() {
      const send = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          id: "message-1",
          embeds: [],
          components: [],
          createMessageComponentCollector: vi.fn().mockReturnValue({ on: vi.fn() }),
        });

      const guild = {
        roles: { cache: { find: vi.fn().mockReturnValue({ id: "role-id", name: "Movie Fans" }) } },
      };

      const channel = { send };
      const interaction: any = {
        client: {
          guilds: {
            fetch: vi.fn().mockResolvedValue({
              roles: guild.roles,
              channels: { fetch: vi.fn().mockResolvedValue(channel) },
            }),
          },
        },
        channel,
        channelId: "channel-123",
        deferred: false,
        replied: false,
        isButton: () => false,
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
      };
      return { interaction, send };
    }

    it("posts a poll with up to five movies and persists poll metadata", async () => {
      const { interaction, send } = buildInteraction();

      const movies = Array.from({ length: 5 }, (_, i) => ({
        id: `movie-${i}`,
        title: `Movie Title ${i}`,
        addedBy: `user-${i}`,
        addedAt: new Date(),
        watched: false,
      }));

      const movieRepo = {
        createPoll: vi.fn().mockResolvedValue(undefined),
        getActiveEvent: vi.fn().mockResolvedValue(null),
        getActivePoll: vi.fn().mockResolvedValue(null),
      };
      const services: any = { repos: { movieRepo } };

      await pollMovieWithList(services, interaction, movies as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "Poll confirmed and posted!",
        embeds: [],
        components: [],
      });

      expect(send).toHaveBeenCalledTimes(2);
      const pollPayload = send.mock.calls[1]?.[0];
      expect(pollPayload.components[0].components).toHaveLength(5);

      const buttonIds = pollPayload.components[0].components.map((btn: any) => btn.data.custom_id);
      expect(new Set(buttonIds).size).toBe(5);

      expect(movieRepo.createPoll).toHaveBeenCalled();
      const pollRecord = movieRepo.createPoll.mock.calls[0]![0];
      expect(pollRecord.options).toHaveLength(5);
      expect(pollRecord.isActive).toBe(true);
    });

    it("updates votes and footers when a user changes selection", async () => {
      const activePoll = {
        isActive: true,
        messageId: "poll-message",
        options: [
          { id: "movie-1", title: "Movie 1" },
          { id: "movie-2", title: "Movie 2" },
        ],
        votes: {} as Record<string, string>,
      };

      const movieRepo = {
        getActivePoll: vi.fn().mockResolvedValue(activePoll),
        createPoll: vi.fn().mockResolvedValue(undefined),
      };
      const services: any = { repos: { movieRepo } };

      const embedData = [
        new EmbedBuilder().setFooter({ text: "option 1" }).toJSON(),
        new EmbedBuilder().setFooter({ text: "option 2" }).toJSON(),
      ];

      const message = {
        id: "poll-message",
        embeds: embedData,
        edit: vi.fn().mockResolvedValue(undefined),
      };

      const interaction: any = {
        customId: "movie_vote_1",
        user: { id: "user-1" },
        client: {},
        message,
        reply: vi.fn().mockResolvedValue(undefined),
      };

      await handleMoviePollVote(services, interaction);
      expect(movieRepo.createPoll).toHaveBeenCalledWith(activePoll);
      expect(message.edit).toHaveBeenCalled();

      // Switch vote to first option
      interaction.customId = "movie_vote_0";
      message.edit.mockClear();
      movieRepo.createPoll.mockClear();

      await handleMoviePollVote(services, interaction);
      expect(activePoll.votes["user-1"]).toBe("movie-1");
      expect(movieRepo.createPoll).toHaveBeenCalled();
      expect(message.edit).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // ⏰ MovieNight scheduler helpers
  // ------------------------------------------------------------------
  describe("MovieNight scheduler helpers", () => {
    it("schedules reminders and sends them at the proper times", async () => {
      const baseDate = new Date("2025-01-01T00:00:00.000Z");
      vi.setSystemTime(baseDate);

      const channelSend = vi.fn().mockResolvedValue(undefined);
      const guild = {
        roles: { cache: { find: vi.fn().mockReturnValue({ id: "role-id", name: "Movie Fans" }) } },
        channels: {
          cache: {
            find: vi.fn().mockReturnValue({
              name: "movie-night",
              isTextBased: () => true,
              send: channelSend,
            }),
          },
        },
      };

      const client: any = { guilds: { fetch: vi.fn().mockResolvedValue(guild) } };
      const movieRepo = {
        getActivePoll: vi.fn().mockResolvedValue({ isActive: false }),
        getActiveEvent: vi.fn().mockResolvedValue({ movie: { title: "The Matrix" } }),
      };

      const services: any = { repos: { movieRepo } };
      const movieStart = DateTime.fromJSDate(new Date(baseDate.getTime() + 60 * 1000));

      await scheduleMovieReminders(services, movieStart, client);
      await vi.advanceTimersByTimeAsync(60 * 1000 + 10);
      await vi.runAllTimersAsync();

      expect(channelSend).toHaveBeenCalledTimes(1);
      const reminderMessage = channelSend.mock.calls[0]![0];
      expect(reminderMessage).toContain("Movie night is starting");
      expect(reminderMessage).toContain("The Matrix");
    });

    it("auto closes polls and schedules auto end when movie starts", async () => {
      // ✅ Lazy import to ensure fake timers are active
      const { closeActiveMoviePoll } = vi.mocked(await import("../../movies/MoviePolls")) as any;
      const { scheduleMovieAutoEnd } = vi.mocked(await import("../../movies/MovieLifecycle")) as any;

      const base = new Date("2025-01-01T00:00:00.000Z");
      vi.setSystemTime(base);

      const activePoll = {
        isActive: true,
        endsAt: new Date(base.getTime() + 1000),
        options: [],
      };

      const movieRepo = {
        getActivePoll: vi
          .fn()
          .mockResolvedValueOnce(activePoll)
          .mockResolvedValueOnce(activePoll),
        getActiveEvent: vi.fn().mockResolvedValue({
          movie: { runtime: 120 },
          startTime: new Date(base.getTime() + 5000),
        }),
      };

      const services: any = { repos: { movieRepo } };

      await scheduleActivePollClosure(services);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.runAllTimersAsync();

      expect(closeActiveMoviePoll).toHaveBeenCalledWith(services, "Scheduler");
      expect(scheduleMovieAutoEnd).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 🗑️ removeMovie command
  // ------------------------------------------------------------------
  describe("removeMovie command", () => {
    function buildInteraction(overrides: Partial<any> = {}) {
      const baseInteraction: any = {
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        options: { getString: vi.fn().mockReturnValue("Inception") },
        user: { id: "user-1", username: "Neo" },
        memberPermissions: { has: vi.fn().mockReturnValue(false) },
      };
      return Object.assign(baseInteraction, overrides);
    }

    it("prevents removal by non-owner non-admin", async () => {
      const interaction = buildInteraction();
      const movieRepo = {
        getAllMovies: vi.fn().mockResolvedValue([
          { id: "movie-1", title: "Inception", addedBy: "owner-1", watched: false },
        ]),
        deleteMovie: vi.fn(),
      };
      const services: any = { repos: { movieRepo } };

      await removemovie.execute({ interaction, services });
      expect(movieRepo.deleteMovie).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        "You can only remove movies you have added."
      );
    });

    it("allows removal by owner", async () => {
      const interaction = buildInteraction({ user: { id: "owner-1", username: "Owner" } });
      const movieRepo = {
        getAllMovies: vi.fn().mockResolvedValue([
          { id: "movie-1", title: "Inception", addedBy: "owner-1", watched: false },
        ]),
        deleteMovie: vi.fn().mockResolvedValue(undefined),
      };
      const services: any = { repos: { movieRepo } };

      await removemovie.execute({ interaction, services });
      expect(movieRepo.deleteMovie).toHaveBeenCalledWith("movie-1");
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it("allows removal by admin", async () => {
      const interaction = buildInteraction({
        memberPermissions: { has: vi.fn().mockReturnValue(true) },
      });
      const movieRepo = {
        getAllMovies: vi.fn().mockResolvedValue([
          { id: "movie-1", title: "Inception", addedBy: "owner-1", watched: false },
        ]),
        deleteMovie: vi.fn().mockResolvedValue(undefined),
      };
      const services: any = { repos: { movieRepo } };

      await removemovie.execute({ interaction, services });
      expect(movieRepo.deleteMovie).toHaveBeenCalledWith("movie-1");
    });
  });
});

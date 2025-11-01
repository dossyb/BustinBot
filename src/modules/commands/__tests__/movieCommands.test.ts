import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../movies/MovieService', () => ({
    addMovieWithStats: vi.fn(),
    fetchMovieDetailsById: vi.fn(),
}));

vi.mock('../../movies/MovieEmbeds', () => ({
    createMovieEmbed: vi.fn(() => ({
        setTitle: vi.fn().mockReturnThis(),
        setFooter: vi.fn().mockReturnThis(),
    })),
}));

vi.mock('../../movies/MovieSelector', () => ({
    presentMovieSelection: vi.fn(),
}));

const { addMovieWithStats, fetchMovieDetailsById } = vi.mocked(await import('../../movies/MovieService'));
const { createMovieEmbed } = vi.mocked(await import('../../movies/MovieEmbeds'));
const { presentMovieSelection } = vi.mocked(await import('../../movies/MovieSelector'));

const { default: addmovie } = await import('../movies/addmovie');
const { default: moviesetup } = await import('../movies/moviesetup');
const { default: tasksetup } = await import('../tasks/tasksetup');

const mockGuilds = {
    requireConfig: vi.fn(),
    get: vi.fn(),
};

const baseServices = {
    guilds: mockGuilds,
    repos: {
        movieRepo: {
            getAllMovies: vi.fn(),
            upsertMovie: vi.fn(),
        },
    },
};

const baseInteraction = () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);

    const guildRoles = new Map<string, { id: string; name: string }>([
        ['movie-admin', { id: 'movie-admin', name: 'Movie Admin' }],
        ['movie-user', { id: 'movie-user', name: 'Movie Fans' }],
    ]);

    const guildChannels = new Map<string, { id: string; name: string }>([
        ['movie-channel', { id: 'movie-channel', name: 'movie-night' }],
        ['movie-vc', { id: 'movie-vc', name: 'Cinema VC' }],
        ['task-channel', { id: 'task-channel', name: 'task-feed' }],
        ['verify-channel', { id: 'verify-channel', name: 'task-verify' }],
    ]);

    const guild = {
        id: 'guild-1',
        ownerId: 'owner-1',
        roles: { cache: { get: (id: string) => guildRoles.get(id) ?? null } },
        channels: { cache: { get: (id: string) => guildChannels.get(id) ?? null } },
    };

    const memberRoles = [{ id: 'member-role' }];
    const interaction: any = {
        guild,
        guildId: guild.id,
        user: { id: 'user-1', username: 'User One' },
        member: {
            roles: { cache: { map: (fn: (role: any) => string) => memberRoles.map(fn) } },
            permissions: { has: vi.fn().mockReturnValue(false) },
        },
        channel: {},
        deferReply,
        editReply,
        reply,
        update: vi.fn(),
        options: {
            getString: vi.fn(),
            getInteger: vi.fn(),
        },
    };

    return { interaction, reply, editReply, deferReply };
};

let randomUUIDSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    mockGuilds.requireConfig.mockReset();
    mockGuilds.get.mockReset();
    baseServices.repos.movieRepo.getAllMovies.mockReset();
    baseServices.repos.movieRepo.upsertMovie.mockReset();
    addMovieWithStats.mockReset();
    fetchMovieDetailsById.mockReset();
    createMovieEmbed.mockReset();
    presentMovieSelection.mockReset();

    if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
        randomUUIDSpy = vi
            .spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValue('uuid-1234' as unknown as `${string}-${string}-${string}-${string}-${string}`);
    } else {
        (globalThis as any).crypto = {
            randomUUID: vi.fn().mockReturnValue('uuid-1234' as unknown as `${string}-${string}-${string}-${string}-${string}`),
        } as unknown as Crypto;
        randomUUIDSpy = undefined;
    }
});

afterEach(() => {
    randomUUIDSpy?.mockRestore();
    randomUUIDSpy = undefined;
});

describe('addmovie command', () => {
    it('prevents non-privileged users from exceeding active movie cap', async () => {
        const { interaction } = baseInteraction();
        interaction.options.getString.mockReturnValue('Inception');
        interaction.options.getInteger.mockReturnValue(null);

        mockGuilds.requireConfig.mockResolvedValue({
            roles: { admin: 'admin-role', movieAdmin: 'movie-admin', movieUser: 'movie-user' },
            channels: {},
        });

        const movies = [
            { id: 'm1', addedBy: 'user-1', watched: false },
            { id: 'm2', addedBy: 'user-1', watched: false },
            { id: 'm3', addedBy: 'user-1', watched: false },
        ];
        baseServices.repos.movieRepo.getAllMovies.mockResolvedValue(movies as any);

        await addmovie.execute({ interaction, services: baseServices as any });

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 1 << 6 });
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.stringContaining('maximum of 3 active movies')
        );
        expect(presentMovieSelection).not.toHaveBeenCalled();
    });

    it('adds movie successfully and responds with embed', async () => {
        const services = {
            ...baseServices,
        };
        const { interaction } = baseInteraction();
        interaction.options.getString.mockReturnValue('The Matrix');
        interaction.options.getInteger.mockReturnValue(1999);

        mockGuilds.requireConfig.mockResolvedValue({
            roles: {},
            channels: {},
        });

        services.repos.movieRepo.getAllMovies.mockResolvedValue([]);
        presentMovieSelection.mockResolvedValue({ id: 123, title: 'The Matrix' });
        fetchMovieDetailsById.mockResolvedValue({
            tmdbId: 123,
            title: 'The Matrix',
            overview: 'A hacker discovers reality.',
            runtime: 136,
        });
        addMovieWithStats.mockResolvedValue(undefined);

        await addmovie.execute({ interaction, services: services as any });

        expect(interaction.deferReply).toHaveBeenCalled();
        expect(presentMovieSelection).toHaveBeenCalledWith(interaction, 'The Matrix', 1999);
        expect(fetchMovieDetailsById).toHaveBeenCalledWith(123);
        expect(addMovieWithStats).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'uuid-1234',
                tmdbId: 123,
                addedBy: 'user-1',
                watched: false,
            }),
            services
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            embeds: [expect.anything()],
            components: [],
        });
        expect(createMovieEmbed).toHaveBeenCalled();
    });
});

describe('moviesetup and tasksetup commands', () => {
    it('presents current movie configuration options', async () => {
        const { interaction, reply } = baseInteraction();
        mockGuilds.get.mockResolvedValue({
            roles: { movieAdmin: 'movie-admin', movieUser: 'movie-user' },
            channels: { movieNight: 'movie-channel', movieVC: 'movie-vc' },
        });

        await moviesetup.execute({ interaction: interaction as any, services: { guilds: mockGuilds } as any });

        expect(mockGuilds.get).toHaveBeenCalledWith('guild-1');
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('Select the channels and roles'),
                components: expect.arrayContaining([
                    expect.objectContaining({ components: expect.any(Array) }),
                ]),
            })
        );
    });

    it('presents current task configuration options', async () => {
        const { interaction, reply } = baseInteraction();
        mockGuilds.get.mockResolvedValue({
            roles: { taskAdmin: 'task-admin', taskUser: 'task-user' },
            channels: { taskChannel: 'task-channel', taskVerification: 'verify-channel' },
        });

        await tasksetup.execute({ interaction: interaction as any, services: { guilds: mockGuilds } as any });

        expect(mockGuilds.get).toHaveBeenCalledWith('guild-1');
        expect(reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('Configure the task roles'),
                components: expect.any(Array),
            })
        );
    });
});

export const mockEmbedInstance = {
    setTitle: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
    setThumbnail: vi.fn().mockReturnThis(),
    setURL: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    setTimestamp: vi.fn().mockReturnThis(),
};

export const EmbedBuilder = vi.fn().mockImplementation(() => mockEmbedInstance);
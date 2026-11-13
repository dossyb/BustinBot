import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./test/setup.ts"],
        env: { BOT_MODE: "test" },
        unstubGlobals: true,
        unstubEnvs: true,
        restoreMocks: true,
        silent: "passed-only",
        projects: [
            {
                extends: true,
                test: {
                    name: "unit",
                    include: ["test/unit/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "integration",
                    include: ["test/integration/**/*.test.ts"],
                    env: {
                        METADATA_SERVER_DETECTION: "none",
                        TMDB_API_KEY: "test-key",
                    },
                },
            },
        ],
    },
});

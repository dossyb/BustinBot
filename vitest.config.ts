import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@tests": path.resolve(__dirname, "./src/tests"),
            core: path.resolve(__dirname, "./src/core"),
            models: path.resolve(__dirname, "./src/models"),
            modules: path.resolve(__dirname, "./src/modules"),
            utils: path.resolve(__dirname, "./src/utils"),
        },
    },
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./src/tests/setup.ts"],
        coverage: { provider: "v8", reporter: ["text", "html"] },
    },
});

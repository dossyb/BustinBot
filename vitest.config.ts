import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./src/tests/setup.ts"],
        coverage: { provider: "v8", reporter: ["text", "html"] },
        alias: {
            "@tests": path.resolve(__dirname, "./src/tests"),
        },
    },
});
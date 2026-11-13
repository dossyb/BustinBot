import { describe, expect, test } from "vitest";
import { truncate } from "../../../src/utils/TextUtils.js";

describe("truncate", () => {
    test("leaves short text unchanged", () => {
        expect(truncate("Hello world", 20)).toBe("Hello world");
    });

    test("cuts text that is too long and ends it with an ellipsis", () => {
        expect(truncate("This is a very long sentence that needs to be cut short.", 20)).toBe("This is a very lo...");
    });

    test("leaves text of exactly the limit unchanged", () => {
        expect(truncate("12345", 5)).toBe("12345");
    });
});

import cron from "node-cron";
import { setGlobalDispatcher } from "undici";
import { afterEach, vi } from "vitest";
import failOnConsole from "vitest-fail-on-console";
import { offlineAgent } from "./firestoreEmulator.js";

setGlobalDispatcher(offlineAgent());

failOnConsole({ shouldPrintMessage: true });

afterEach(() => cron.shutdown());

afterEach(() => vi.useRealTimers());

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const packageInfo = require("../../package.json") as { version?: string };

export const packageVersion = packageInfo.version ?? "v2";
export { packageInfo };


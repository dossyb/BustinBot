// Works in both ESM and CommonJS
import { fileURLToPath } from "url";
import path from "path";

export function getFilename(metaUrl: string): string {
  if (typeof __filename !== "undefined") return __filename;
  return fileURLToPath(metaUrl);
}

export function getDirname(metaUrl: string): string {
  if (typeof __dirname !== "undefined") return __dirname;
  return path.dirname(fileURLToPath(metaUrl));
}

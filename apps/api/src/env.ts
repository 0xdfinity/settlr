import fs from "node:fs";
import path from "node:path";

/**
 * Minimal local .env loader for development.
 * Real environment variables always win; missing/invalid lines fail loudly.
 * Docker injects variables directly, so absence of .env is expected there.
 */
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const [lineNumber, raw] of fs.readFileSync(envPath, "utf8").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) throw new Error(`.env line ${lineNumber + 1} must be KEY=value`);
    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`.env line ${lineNumber + 1} has invalid key '${key}'`);
    if (process.env[key] !== undefined) continue;
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

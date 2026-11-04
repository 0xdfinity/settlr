import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().url(),
  PAYPAL_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(16),
  VERIFIER_HMAC_SECRET: z.string().min(16),
  GROQ_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("openai/gpt-oss-120b"),
  AI_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  CHANNEL3_API_KEY: z.string().optional().default(""),
  PUBLIC_API_URL: z.string().url().default("http://localhost:8787"),
  WEB_RETURN_URL: z.string().url().default("http://localhost:3000/deals/return"),
  WEB_CANCEL_URL: z.string().url().default("http://localhost:3000/deals/cancel"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Settlr API config invalid:\n${issues}`);
  }
  return parsed.data;
}

export const PAYPAL_BASE_URL = (env: "sandbox" | "production") =>
  env === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

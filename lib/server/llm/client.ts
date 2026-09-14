import Anthropic from "@anthropic-ai/sdk";

// The SDK is given ONLY the key from the environment - never a login profile
// or other ambient credential - so nothing is billed unless someone has
// deliberately put ANTHROPIC_API_KEY in .env.local (or the host's secrets).
// Without a key the SDK throws before sending and the pipeline falls back to
// a canned reply, which keeps the UI usable offline.
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

export const llmEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

// Override with ANTHROPIC_MODEL. Sonnet is the default because it is the
// cheaper choice for iterating on prompts; switch to claude-opus-5 for demos.
export const GENERATION_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

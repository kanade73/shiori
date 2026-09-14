import Anthropic from "@anthropic-ai/sdk";

// Intentionally disabled to avoid incurring API cost. Passing an explicit
// (even empty) `apiKey` stops the SDK from falling back to
// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, an `ant auth login` profile, or
// Workload Identity Federation - so this always sends an empty credential
// and every request fails with 401 before anything is billed, regardless of
// what auth might otherwise be available in the environment.
//
// To re-enable real calls: replace the line below with
//   export const anthropic = new Anthropic();
// and set ANTHROPIC_API_KEY (see .env.local.example).
export const anthropic = new Anthropic({ apiKey: "" });

export const GENERATION_MODEL = "claude-opus-5";

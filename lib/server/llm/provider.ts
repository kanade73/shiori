import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic, GENERATION_MODEL } from "./client";

/**
 * One entry point for "give me a structured object from the model", so the
 * rest of the pipeline never knows which provider is behind it.
 *
 * - anthropic (default when ANTHROPIC_API_KEY is set): what ships. Deploy
 *   targets use this.
 * - ollama: development-only. Runs a local model so the pipeline mechanics
 *   (claims extraction, consistency check, regeneration) can be exercised
 *   for free. Output quality is NOT representative - do not judge the lies
 *   or the persona on it.
 *
 * Select with LLM_PROVIDER=anthropic|ollama. Falls back to ollama when no
 * API key is present and an explicit choice was not made.
 */

export type LlmProvider = "anthropic" | "ollama";

export function currentProvider(): LlmProvider {
  const explicit = process.env.LLM_PROVIDER;
  if (explicit === "anthropic" || explicit === "ollama") return explicit;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "ollama";
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

export type StructuredRequest<T extends z.ZodType> = {
  system: string;
  messages: Anthropic.MessageParam[];
  schema: T;
  maxTokens?: number;
};

export async function generateStructured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
  return currentProvider() === "ollama" ? generateWithOllama(req) : generateWithAnthropic(req);
}

async function generateWithAnthropic<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
  const response = await anthropic.messages.parse({
    model: GENERATION_MODEL,
    max_tokens: req.maxTokens ?? 2048,
    system: req.system,
    output_config: { format: zodOutputFormat(req.schema) },
    messages: req.messages,
  });
  if (!response.parsed_output) throw new Error("Failed to parse generation output");
  return response.parsed_output;
}

async function generateWithOllama<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
  const messages = [
    { role: "system", content: req.system },
    ...req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""),
    })),
  ];

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      think: false,
      format: z.toJSONSchema(req.schema),
      options: { num_predict: req.maxTokens ?? 2048, temperature: 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`ollama: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content ?? "";
  return req.schema.parse(JSON.parse(raw));
}

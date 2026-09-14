import { z } from "zod";

export const UserMessageAnalysisSchema = z.object({
  mentionedCharacters: z.array(z.string()),
  mentionedEvents: z.array(z.string()),
  sentiment: z.string(),
  questionType: z.enum(["impression", "memory_check", "theory", "fact_question", "other"]),
});

export const NewFactDraftSchema = z.object({
  subject: z.string(),
  relation: z.string(),
  object: z.string(),
  claim: z.string(),
  sourceCanonFactIds: z.array(z.string()),
});

export const GenerationResultSchema = z.object({
  message: z.string(),
  strategy: z.enum([
    "no_new_lie",
    "introduce_small_lie",
    "reinforce_existing_lie",
    "avoid_spoiler",
    "admit_uncertainty",
  ]),
  newFacts: z.array(NewFactDraftSchema),
  usedExistingFactIds: z.array(z.string()),
  spoilerRisk: z.number().min(0).max(1),
});

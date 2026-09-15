/** Re-evaluate recorded raw generations without an API call or any session writes. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const source = path.resolve(process.argv[2] || ".data/shiori-room-yKOo9S");
const output = fs.mkdtempSync(path.join(root, ".data/evaluate-recheck-"));
const oldSource = execFileSync("git", ["show", "e38df88:lib/server/llm/evaluate.ts"], { encoding: "utf8" });
fs.writeFileSync(path.join(output, "before.ts"), oldSource.replace(/from "(\.[^"]+)"/g,
  (_, relative) => `from ${JSON.stringify(path.resolve(root, "lib/server/llm", relative) + ".ts")}`));
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if ((specifier.startsWith(".") || specifier.startsWith("/")) && !path.extname(specifier)) return nextResolve(specifier + ".ts", context);
    throw error;
  }
} });
const old = await import(path.join(output, "before.ts"));
const current = await import(path.join(root, "lib/server/llm/evaluate.ts"));
const { getVisibleCanonFacts } = await import(path.join(root, "lib/server/retrieval.ts"));
const { getEntities } = await import(path.join(root, "lib/server/works.ts"));
const { buildNormalizer } = await import(path.join(root, "lib/server/claims.ts"));
const { formatEpisodeFrom } = await import(path.join(root, "lib/server/llm/context.ts"));
const results = JSON.parse(fs.readFileSync(path.join(source, "results.json"), "utf8"));
const db = JSON.parse(fs.readFileSync(path.join(source, "sessions/db.json"), "utf8"));
const checked = [];
for (const turn of results.turns.filter((t) => t.phase === "conversation")) {
  const session = db.sessions[turn.sessionId];
  const messages = db.messages[turn.sessionId];
  const user = messages.filter((m) => m.role === "user")[turn.turn - 1];
  const userIndex = messages.findIndex((m) => m.id === user.id);
  const earlier = new Set(messages.slice(0, userIndex).map((m) => m.id));
  const existingFabricatedFacts = db.fabricatedFacts[session.id].filter((f) => earlier.has(f.introducedMessageId));
  const canonById = new Map(getVisibleCanonFacts(session).map((f) => [f.id, f]));
  const calls = results.calls.filter((c) => c.phase === "conversation" && c.arm === turn.arm && c.turn === turn.turn &&
    c.request.config?.systemInstruction?.includes("登場するキャラクター「シオリ」"));
  assert.equal(calls.length, turn.regenerated ? 2 : 1);
  for (const [attempt, call] of calls.entries()) {
    // Match the exact canon block sent, rather than using the session's final topic.
    const block = call.request.config.systemInstruction.split("# 本物の設定")[1].split("# あなたが前に話したこと")[0];
    const lines = block.split("\n").filter((line) => /^- \[/.test(line));
    const visibleCanonFacts = lines.map((line) => {
      const id = /^- \[([^\]]+)\]/.exec(line)[1];
      const fact = canonById.get(id);
      assert.ok(fact, `Missing ${id}`);
      assert.equal(line, `- [${fact.id}] ${formatEpisodeFrom(fact.episodeFrom)}${fact.subject} が ${fact.object} に対して${fact.relation}。${fact.description}`);
      return fact;
    });
    const generation = { ...JSON.parse(call.responseText), strategy: "no_new_lie" };
    const params = { result: generation, visibleCanonFacts, existingFabricatedFacts, normalize: buildNormalizer(getEntities(session.workId)) };
    const before = old.evaluateGeneration(params);
    const after = current.evaluateGeneration(params);
    // Reconstructing the old decision must exactly reproduce the recorded retry/fallback path.
    assert.equal(before.shouldRegenerate, attempt === 0 ? turn.regenerated : turn.generation.strategy === "admit_uncertainty");
    checked.push({ arm: turn.arm, turn: turn.turn, attempt: attempt + 1, generation, before, after });
  }
}
const summary = {
  source, rawGenerations: checked.length,
  previouslyRejected: checked.filter((c) => c.before.shouldRegenerate).length,
  rejectedAfterFix: checked.filter((c) => c.after.shouldRegenerate).length,
  released: checked.filter((c) => c.before.shouldRegenerate && !c.after.shouldRegenerate).length,
  newlyRejected: checked.filter((c) => !c.before.shouldRegenerate && c.after.shouldRegenerate).length,
  note: "Same recorded claims, canon and prior lies; no regeneration, no API calls. Not a simulated new conversation.",
};
fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ summary, checked }, null, 2));
console.log(JSON.stringify({ output, ...summary }, null, 2));

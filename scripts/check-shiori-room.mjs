/**
 * node --env-file=.env.local scripts/check-shiori-room.mjs [--live] [--replay-only]
 * Default is offline request inspection, NOT a model quality test.
 * --live: paired fixed-history replay + two independent 24-turn real pipelines.
 * SHIORI_COMPARE=evaluate freezes only the old checker; SHIORI_RESUME_DIR resumes an interrupted run.
 * Output and session DB stay in .data; never overwrite the user's sessions.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const live = process.argv.includes("--live");
const baselineRef = process.env.SHIORI_BASELINE_REF || "e38df88";
const compare = process.env.SHIORI_COMPARE || "directive";
if (!["directive", "evaluate"].includes(compare)) throw new Error("SHIORI_COMPARE must be directive or evaluate");
const frozen = compare === "evaluate" ? ["evaluate"] : ["generate", "directive"];
const resume = process.env.SHIORI_RESUME_DIR;
const output = resume ? path.resolve(root, resume) : fs.mkdtempSync(path.join(root, ".data/shiori-room-"));
const previous = resume ? JSON.parse(fs.readFileSync(path.join(output, "results.json"), "utf8")) : null;
process.env.DATA_DIR = path.join(output, "sessions");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
// Reuse embeddings without mutating the user's DB or consuming a fresh bulk quota.
for (const directory of ["vectors", "creators"]) {
  const source = path.join(root, ".data", directory);
  if (!resume && fs.existsSync(source)) fs.cpSync(source, path.join(process.env.DATA_DIR, directory), { recursive: true });
}
const fixturePath = process.env.SHIORI_FIXTURE || "scripts/fixtures/shiori-room.json";
const fixture = JSON.parse(fs.readFileSync(path.resolve(root, fixturePath), "utf8"));
const baseline = path.join(output, "baseline");
fs.mkdirSync(baseline, { recursive: true });
for (const name of ["generate", "directive", "pipeline", "evaluate"]) {
  if (resume) continue;
  const source = frozen.includes(name)
    ? execFileSync("git", ["show", `${baselineRef}:lib/server/llm/${name}.ts`], { encoding: "utf8" })
    : fs.readFileSync(path.join(root, `lib/server/llm/${name}.ts`), "utf8");
  // Freeze the selected change only. All other behavior is the current implementation.
  const rewritten = source.replace(/from "(\.[^"]+)"/g, (_, relative) => {
    const target = ["./generate", "./directive", "./evaluate"].includes(relative)
      ? path.join(baseline, relative + ".ts")
      : path.resolve(root, "lib/server/llm", relative) + ".ts";
    return `from ${JSON.stringify(target)}`;
  });
  fs.writeFileSync(path.join(baseline, name + ".ts"), rewritten);
}
// Node 22.18+ strips TypeScript; resolve the app's extensionless TS imports.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if ((specifier.startsWith(".") || specifier.startsWith("/")) && !path.extname(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw error;
  }
} });
const { ai, GENERATION_MODEL } = await import(path.join(root, "lib/server/llm/client.ts"));
const store = await import(path.join(root, "lib/server/store.ts"));
const works = await import(path.join(root, "lib/server/works.ts"));
const retrieval = await import(path.join(root, "lib/server/retrieval.ts"));
const { analyzeUserMessage } = await import(path.join(root, "lib/server/llm/analyze.ts"));
const { buildNormalizer, findDuplicate, normalizeTriple } = await import(path.join(root, "lib/server/claims.ts"));
const work = works.getWork(fixture.workId);
if (!work) throw new Error("Fixture work is not installed");
const normalize = buildNormalizer(works.getEntities(work.id));
const arms = {};
for (const arm of ["before", "after"]) {
  const directory = arm === "before" ? baseline : path.join(root, "lib/server/llm");
  arms[arm] = { ...await import(path.join(directory, "generate.ts")),
    ...await import(path.join(directory, "directive.ts")), ...await import(path.join(directory, "pipeline.ts")), ...await import(path.join(directory, "evaluate.ts")) };
}
let active = {};
let lastCall = 0;
let fatalApiError;
if (previous && (previous.mode !== "live" || previous.compare !== compare || previous.fixturePath !== fixturePath || previous.model !== GENERATION_MODEL)) {
  throw new Error("Resume requires the same live comparison, fixture and model");
}
const calls = previous?.calls ?? [];
const turns = previous?.turns ?? [];
const errors = previous?.errors ?? [];
const save = () => fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({
  mode: live ? "live" : "offline-request-inspection", baselineRef, compare, fixturePath, model: GENERATION_MODEL,
  note: "offline calls have no model output or token measurement; claims are model annotations, not independent factual verification",
  calls, turns, errors,
}, null, 2));
for (const method of ["generateContent", "embedContent"]) {
  const original = ai.models[method].bind(ai.models);
  ai.models[method] = async (request) => {
    if (fatalApiError) throw fatalApiError;
    const call = { ...active, method, model: request.model, request,
      systemChars: request.config?.systemInstruction?.length ?? 0,
      contentsChars: JSON.stringify(request.contents ?? "").length };
    calls.push(call);
    if (!live) {
      if (method !== "generateContent") throw new Error("Embedding is not part of offline inspection");
      save();
      return { text: JSON.stringify({ message: "[OFFLINE: no model response]", claims: [] }) };
    }
    // Shared throttle for Shiori, Toshio and router. Never retry a billing failure.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(process.env.SHIORI_INTERVAL_MS || 13000) - (Date.now() - lastCall))));
    lastCall = Date.now();
    const start = Date.now();
    try {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await original(request); break; }
        catch (error) {
          // Retry per-minute quotas and transient 5xx; depleted credits/daily limits stop.
          const minuteQuota = /RequestsPerMinute|TokensPerMinute/.test(error.message);
          const unavailable = [500, 502, 503, 504].includes(error.status);
          if (attempt === 2 || (!minuteQuota && !unavailable)) throw error;
          const delay = minuteQuota ? 60000 : 5000 * (attempt + 1);
          call.transientRetries = (call.transientRetries ?? 0) + 1;
          console.log(`Transient API error: waiting ${delay / 1000} seconds before retry`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          lastCall = Date.now();
        }
      }
      Object.assign(call, { elapsedMs: Date.now() - start, usage: response.usageMetadata,
        finishReasons: response.candidates?.map((c) => c.finishReason), responseText: response.text });
      save();
      return response;
    } catch (error) {
      // SDK errors contain service messages; request authentication is never written.
      call.error = error.message;
      fatalApiError = error;
      save();
      throw error;
    }
  };
}

async function replay() {
  for (let repeat = 0; repeat < (live ? 2 : 1); repeat++) {
    for (const scenario of fixture.replay) {
      const history = fixture.history.slice(0, scenario.historyLength).map((m, i) => ({
        id: `m${i}`, sessionId: "replay", role: m.role, speaker: m.speaker, content: m.content,
        createdAt: new Date(i * 1000).toISOString(),
      }));
      const facts = fixture.history.slice(0, scenario.historyLength).flatMap((m, i) => m.lie ? [{
        ...m.lie, id: `f${i}`, sessionId: "replay", claim: `${m.lie.subject}は${m.lie.object}`,
        negated: false, sourceCanonFactIds: [], introducedMessageId: `m${i}`, confidence: 0.8,
        status: "active", createdAt: new Date(i * 1000).toISOString(),
      }] : []);
      const analysis = analyzeUserMessage({ workId: work.id, currentEpisode: 0, userMessage: scenario.userMessage });
      const topic = { title: fixture.topicTitle, summary: fixture.topicSummary, facts: [], sources: [], query: "fixture", resolvedAt: new Date(0).toISOString() };
      for (const arm of repeat % 2 ? ["after", "before"] : ["before", "after"]) {
        if (turns.some((t) => t.phase === "replay" && t.arm === arm && t.scenario === scenario.name && t.repeat === repeat)) continue;
        active = { phase: "replay", arm, scenario: scenario.name, repeat };
        const directive = arms[arm].decideDirective({ analysis, history, userMessage: scenario.userMessage, fabricatedFacts: facts, relevantFacts: facts });
        const generation = await arms[arm].generateResponse({ workTitle: work.title, currentEpisode: 0,
          topic, canonFacts: [], fabricatedFacts: facts, directive, history, userMessage: scenario.userMessage });
        const newClaims = generation.claims.filter((c) => c.grounding === "fabricated" && !findDuplicate(normalizeTriple(c, normalize), facts));
        turns.push({ ...active, userMessage: scenario.userMessage, directive, generation, newClaims,
          evaluation: arms[arm].evaluateGeneration({ result: generation, visibleCanonFacts: [], existingFabricatedFacts: facts, normalize }) });
        save();
        console.log(`${arm} replay ${scenario.name}: ${generation.message}`);
      }
    }
  }
}

async function conversations() {
  const sessions = Object.fromEntries(Object.keys(arms).map((arm) => {
    const completed = turns.find((t) => t.phase === "conversation" && t.arm === arm);
    if (completed) return [arm, completed.sessionId];
    const session = store.createSession(work.id);
    store.appendMessage(session.id, "assistant", fixture.history[0].content, "shiori");
    return [arm, session.id];
  }));
  // Same fixed user turns; each arm retains its own generated replies and lies.
  for (const [index, userMessage] of fixture.conversation.entries()) {
    for (const arm of index % 2 ? ["after", "before"] : ["before", "after"]) {
      if (turns.some((t) => t.phase === "conversation" && t.arm === arm && t.turn === index + 1)) continue;
      active = { phase: "conversation", arm, turn: index + 1 };
      const session = store.getSession(sessions[arm]);
      // Same cap as the message Route Handler. Full-session length is not input length.
      const messages = store.getMessages(session.id);
      const userCount = messages.filter((m) => m.role === "user").length;
      const last = messages.at(-1);
      const pending = userCount === index + 1 && last?.role === "user" && last.content === userMessage;
      // A failed router/generation may leave only the current user record. Reuse it.
      // If a partial assistant turn was already saved, stop instead of duplicating it.
      if (userCount !== index && !pending) throw new Error("Cannot resume a partially saved assistant turn automatically");
      const history = (pending ? messages.slice(0, -1) : messages).slice(-12);
      const user = pending ? last : store.appendMessage(session.id, "user", userMessage);
      const params = { workId: work.id, workTitle: work.title, sessionId: session.id,
        currentEpisode: session.currentEpisode, topic: session.topic, pastTopics: session.pastTopics,
        history, userMessage, userMessageAt: user.createdAt };
      const result = await arms[arm].runConversationPipeline(params);
      if (fatalApiError) throw fatalApiError;
      if (result.newTopic || result.currentEpisode !== session.currentEpisode) store.setSessionTopic(session.id, result.newTopic, result.currentEpisode);
      const message = store.appendMessage(session.id, "assistant", result.generation.message, "shiori");
      store.saveMessageClaims(session.id, message.id, result.generation.claims);
      for (const claim of result.newFabricatedClaims) store.addFabricatedFact({ ...claim, sessionId: session.id, introducedMessageId: message.id, confidence: 0.8 });
      const toshio = await arms[arm].runToshioInterjection({ ...params, currentEpisode: result.currentEpisode,
        topic: result.newTopic ?? session.topic, analysis: result.analysis, generation: result.generation });
      if (fatalApiError) throw fatalApiError;
      if (toshio) store.appendMessage(session.id, "assistant", toshio, "toshio");
      turns.push({ ...active, sessionId: session.id, userMessage, historyCount: history.length,
        ...result, toshio, totalStoredLies: retrieval.getActiveFabricatedFacts(session.id).length });
      save();
      console.log(`${arm} turn ${index + 1}: ${result.generation.message}`);
    }
  }
}

console.log(`Results: ${output}`);
try {
  if (!process.argv.includes("--conversation-only")) await replay();
  if (live && !process.argv.includes("--replay-only")) await conversations();
} catch (error) {
  errors.push({ ...active, message: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  save();
  console.log(`Saved ${calls.length} calls / ${turns.length} completed turns to ${output}`);
}

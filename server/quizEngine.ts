import type { IncomingMessage, Server } from 'http';
import type { GoogleGenAI } from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import { fastLocalQuizCheck, smartSemanticFallbackCheck } from '../src/lib/quizGrader.ts';
import { normalizeBrawlDifficulty } from '../src/lib/brawlDifficulty.ts';
import {
  buildMcqChoices,
  isMcqSelectionCorrect,
  type QuizGameMode,
  type QuizQuestionFormat,
} from '../src/lib/quizMcq.ts';
import type { BrawlDifficulty } from '../src/types.ts';
import { getDeckById, type StoredQuizCard } from './quizDb.ts';

import {
  buildGeminiCandidateList,
  buildOpenAiCandidateList,
  createGeminiClient,
  DEFAULT_GROK_BASE_URL,
  discoverOpenAiModels,
  normalizeOpenAiBaseUrl,
  parseUserAiConfig,
  shouldFallbackToNextModel,
  type UserAiConfig,
} from './aiRouter.ts';

const GRADING_MODEL_CANDIDATES = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-4-hydrogen',
] as const;
let cachedWorkingModel: string | null = null;
const cachedWorkingOpenAiModelByKey = new Map<string, string>();
let genAiModulePromise: Promise<typeof import('@google/genai')> | null = null;

function loadGenAiModule(): Promise<typeof import('@google/genai')> {
  if (!genAiModulePromise) {
    genAiModulePromise = import('@google/genai');
  }
  return genAiModulePromise;
}

async function getSiteAiClient(): Promise<GoogleGenAI | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) return null;
  return createGeminiClient(apiKey);
}

async function gradeViaOpenAiCompatible(
  config: UserAiConfig,
  systemInstruction: string,
  userContent: string
): Promise<{ text: string; model: string }> {
  const isGrok = config.provider === 'grok';
  const baseUrl = isGrok ? DEFAULT_GROK_BASE_URL : normalizeOpenAiBaseUrl(config.baseUrl);
  const cacheKey = `${config.provider}|${baseUrl}|${config.apiKey.slice(-8)}`;
  const cachedModel = cachedWorkingOpenAiModelByKey.get(cacheKey);
  const effectiveConfig: UserAiConfig =
    cachedModel && !config.model ? { ...config, verifiedModel: cachedModel } : config;
  const candidates = buildOpenAiCandidateList(effectiveConfig);
  const triedSet = new Set(candidates);
  let discoveredExtra = false;

  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      let res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          max_tokens: isGrok ? 512 : 180,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userContent },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok && res.status === 400) {
        const errText = await res.text().catch(() => '');
        if (/response_format|json_object/i.test(errText) && !/model/i.test(errText)) {
          res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: isGrok ? 512 : 180,
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: userContent },
              ],
            }),
            signal: controller.signal,
          });
        } else {
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = (data.choices?.[0]?.message?.content || '').trim();
      if (!text) {
        throw new Error(`Empty response from ${model}`);
      }
      cachedWorkingOpenAiModelByKey.set(cacheKey, model);
      return { text, model };
    } catch (err) {
      lastErr = err;
      if (!shouldFallbackToNextModel(err, config)) {
        throw err;
      }
      if (i === candidates.length - 1 && !discoveredExtra && !isGrok) {
        discoveredExtra = true;
        const extra = await discoverOpenAiModels(baseUrl, config.apiKey, triedSet);
        for (const em of extra) {
          triedSet.add(em);
          candidates.push(em);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function generateGradingContent(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction: string;
    maxOutputTokens?: number;
    responseSchema: Record<string, unknown>;
    byokConfig?: UserAiConfig | null;
  }
) {
  const baseList: string[] = params.byokConfig
    ? buildGeminiCandidateList(params.byokConfig)
    : cachedWorkingModel
    ? [cachedWorkingModel, ...GRADING_MODEL_CANDIDATES.filter((m) => m !== cachedWorkingModel)]
    : [...GRADING_MODEL_CANDIDATES];

  const { ThinkingLevel } = await loadGenAiModule();
  let lastErr: unknown = null;
  for (const model of baseList) {
    const thinkingConfig = /^gemini-4-/i.test(model)
      ? { thinkingLevel: ThinkingLevel.LOW }
      : /^gemini-3\./i.test(model)
      ? { thinkingLevel: ThinkingLevel.MINIMAL }
      : /^gemini-2\.5-/i.test(model)
      ? { thinkingBudget: 0 }
      : undefined;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
            responseMimeType: 'application/json',
            responseSchema: params.responseSchema,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout from ${model}`)), 6500)
        ),
      ]);
      if (!response.text || !response.text.trim()) {
        throw new Error(`Empty response from ${model}`);
      }
      if (!params.byokConfig) {
        cachedWorkingModel = model;
      }
      return { response, model };
    } catch (err) {
      lastErr = err;
      if (params.byokConfig && !shouldFallbackToNextModel(err, params.byokConfig)) {
        throw err;
      }
    }
  }
  throw lastErr;
}

export interface GradeOutcome {
  correct: boolean;
  source: 'local' | 'ai' | 'fallback';
  latencyMs: number;
  model?: string;
  usedByok?: boolean;
  reason?: string;
  error?: string;
}

const GRADING_SYSTEM_INSTRUCTION =
  'You are a fair, experienced teacher grading a quick recall flashcard/quiz answer. Judge by core factual understanding against the Question and Official Answer — NEVER penalize valid wording differences.\n' +
  'Mark correct=true when:\n' +
  '- The student paraphrases, uses everyday/plain-English wording, active/passive voice, or reordered clauses that express the same meaning.\n' +
  '- The Official Answer contains extra elaboration, parenthetical notes, or secondary details, and the student accurately captures the essential core answer.\n' +
  '- The student gives a valid synonym, acronym/expanded form (e.g. USA/America/US, ATP, CO2/carbon dioxide), chemical formula/name, UK/US spelling, singular/plural, different tense, minor typo, or equivalent unit/number format.\n' +
  '- Dates omit the exact day (e.g. "Nov 1918" or "1918" for "9 November 1918") unless the day itself is the explicit point of contradiction.\n' +
  '- Both answers are factually equivalent in context of the Question.\n' +
  'Mark correct=false ONLY if the student answer is factually wrong, names a different person/event/term/year/value, is too vague to show knowledge, or misses the main concept.\n' +
  'Output strict JSON with a brief 1-sentence comparison "reason" BEFORE "correct": {"reason":"...", "correct": true/false}.';

function parseGradeJson(rawText: string): { correct: boolean; reason?: string } {
  try {
    const parsed = JSON.parse(rawText) as { correct?: boolean; reason?: string };
    return {
      correct: Boolean(parsed?.correct),
      reason: typeof parsed?.reason === 'string' ? parsed.reason.trim() : undefined,
    };
  } catch {
    return {
      correct: /"correct"\s*:\s*true/i.test(rawText),
    };
  }
}

export async function gradeSingleAnswer(
  question: string,
  officialAnswer: string,
  studentAnswer: string,
  userAiConfig?: UserAiConfig | null
): Promise<GradeOutcome> {
  const started = Date.now();
  const trimmed = String(studentAnswer || '').trim();
  if (!trimmed) {
    return { correct: false, source: 'local', latencyMs: 0 };
  }

  if (fastLocalQuizCheck(trimmed, officialAnswer)) {
    return { correct: true, source: 'local', latencyMs: 0 };
  }

  const promptContent = `Question: ${question}\nOfficial Answer: ${officialAnswer}\nStudent Answer: ${trimmed}`;

  // If user brought their own API key, grade exclusively with their API
  if (userAiConfig?.apiKey) {
    try {
      if (userAiConfig.provider === 'grok' || userAiConfig.provider === 'openai-compatible') {
        const { text: rawText, model } = await gradeViaOpenAiCompatible(
          userAiConfig,
          GRADING_SYSTEM_INSTRUCTION,
          promptContent
        );
        const parsed = parseGradeJson(rawText);
        return {
          correct: parsed.correct,
          reason: parsed.reason,
          source: 'ai',
          latencyMs: Date.now() - started,
          model,
          usedByok: true,
        };
      }

      const byokAi = createGeminiClient(userAiConfig.apiKey);
      const { Type } = await loadGenAiModule();
      const { response, model } = await generateGradingContent(byokAi, {
        contents: promptContent,
        systemInstruction: GRADING_SYSTEM_INSTRUCTION,
        maxOutputTokens: 160,
        byokConfig: userAiConfig,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reason: { type: Type.STRING },
            correct: { type: Type.BOOLEAN },
          },
          required: ['reason', 'correct'],
        },
      });
      const rawText = (response.text || '').trim();
      const parsed = parseGradeJson(rawText);
      return {
        correct: parsed.correct,
        reason: parsed.reason,
        source: 'ai',
        latencyMs: Date.now() - started,
        model,
        usedByok: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('BYOK quiz grading fallback used:', msg);
      return {
        correct: smartSemanticFallbackCheck(trimmed, officialAnswer),
        source: 'fallback',
        latencyMs: Date.now() - started,
        usedByok: true,
        error: msg.slice(0, 220),
      };
    }
  }

  // Website API is strictly used ONLY for Live Quiz marking when user has no personal API key
  const ai = await getSiteAiClient();
  if (!ai) {
    return {
      correct: smartSemanticFallbackCheck(trimmed, officialAnswer),
      source: 'fallback',
      latencyMs: Date.now() - started,
      error: 'GEMINI_API_KEY not configured',
    };
  }

  try {
    const { Type } = await loadGenAiModule();
    const { response, model } = await generateGradingContent(ai, {
      contents: promptContent,
      systemInstruction: GRADING_SYSTEM_INSTRUCTION,
      maxOutputTokens: 160,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reason: { type: Type.STRING },
          correct: { type: Type.BOOLEAN },
        },
        required: ['reason', 'correct'],
      },
    });

    const rawText = (response.text || '').trim();
    const parsed = parseGradeJson(rawText);

    return {
      correct: parsed.correct,
      reason: parsed.reason,
      source: 'ai',
      latencyMs: Date.now() - started,
      model,
      usedByok: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Gemini quiz grading fallback used:', msg);
    return {
      correct: smartSemanticFallbackCheck(trimmed, officialAnswer),
      source: 'fallback',
      latencyMs: Date.now() - started,
      usedByok: false,
      error: msg.slice(0, 220),
    };
  }
}

export interface BatchGradeItem {
  id: string;
  question: string;
  officialAnswer: string;
  studentAnswer: string;
}

export interface BatchGradeResult {
  id: string;
  correct: boolean;
  source: 'local' | 'ai' | 'fallback';
  usedByok?: boolean;
}

export async function gradeBatchAnswers(
  items: BatchGradeItem[],
  userAiConfig?: UserAiConfig | null
): Promise<BatchGradeResult[]> {
  const results = new Map<string, BatchGradeResult>();
  const needsAi: BatchGradeItem[] = [];

  for (const item of items) {
    if (!String(item.studentAnswer || '').trim()) {
      results.set(item.id, { id: item.id, correct: false, source: 'local' });
    } else if (fastLocalQuizCheck(item.studentAnswer, item.officialAnswer)) {
      results.set(item.id, { id: item.id, correct: true, source: 'local' });
    } else {
      needsAi.push(item);
    }
  }

  if (needsAi.length > 0) {
    const promptLines = needsAi
      .map(
        (it, idx) =>
          `${idx + 1}. [id=${it.id}] Q: ${it.question} | Official: ${it.officialAnswer} | Student: ${it.studentAnswer}`
      )
      .join('\n');

    if (
      userAiConfig?.apiKey &&
      (userAiConfig.provider === 'grok' || userAiConfig.provider === 'openai-compatible')
    ) {
      try {
        const { text: rawText } = await gradeViaOpenAiCompatible(
          userAiConfig,
          'Return strict JSON {"results":[{"id":"...","correct":true}]}. Grade each numbered student flashcard answer generously by core factual meaning against the official answer.',
          promptLines
        );
        const parsed = JSON.parse(rawText || '{}') as {
          results?: Array<{ id: string; correct: boolean }>;
        };
        const aiMap = new Map<string, boolean>();
        if (Array.isArray(parsed?.results)) {
          parsed.results.forEach((row) => {
            if (row && typeof row.id === 'string') {
              aiMap.set(row.id, Boolean(row.correct));
            }
          });
        }
        for (const item of needsAi) {
          results.set(item.id, {
            id: item.id,
            correct: aiMap.get(item.id) ?? false,
            source: 'ai',
            usedByok: true,
          });
        }
      } catch (err) {
        console.error('BYOK OpenAI-compatible batch grading fallback:', err);
        for (const item of needsAi) {
          results.set(item.id, {
            id: item.id,
            correct: smartSemanticFallbackCheck(item.studentAnswer, item.officialAnswer),
            source: 'fallback',
            usedByok: true,
          });
        }
      }
    } else {
      const usingByok = Boolean(userAiConfig?.apiKey);
      const ai = userAiConfig?.apiKey
        ? createGeminiClient(userAiConfig.apiKey)
        : await getSiteAiClient();

      if (!ai) {
        for (const item of needsAi) {
          results.set(item.id, {
            id: item.id,
            correct: smartSemanticFallbackCheck(item.studentAnswer, item.officialAnswer),
            source: 'fallback',
          });
        }
      } else {
        try {
          const { Type } = await loadGenAiModule();
          const { response } = await generateGradingContent(ai, {
            contents: promptLines,
            systemInstruction:
              'You are a fair teacher grading numbered flashcard answers by core factual meaning against the Official Answer. Accept paraphrases, plain-English wording, passive/active flips, core points when official answers have extra detail/parentheticals, acronyms/abbreviations, UK/US spelling, unit equivalents, minor typos, and month+year dates. Only mark false if factually wrong or missing the core point. Return strict JSON array of {id, reason, correct}.',
            byokConfig: userAiConfig || null,
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  correct: { type: Type.BOOLEAN },
                },
                required: ['id', 'reason', 'correct'],
              },
            },
          });

          const parsed = JSON.parse((response.text || '[]').trim()) as Array<{
            id: string;
            correct: boolean;
          }>;
          const aiMap = new Map<string, boolean>();
          if (Array.isArray(parsed)) {
            parsed.forEach((row) => {
              if (row && typeof row.id === 'string') {
                aiMap.set(row.id, Boolean(row.correct));
              }
            });
          }
          for (const item of needsAi) {
            results.set(item.id, {
              id: item.id,
              correct: aiMap.get(item.id) ?? false,
              source: 'ai',
              usedByok: usingByok,
            });
          }
        } catch (err) {
          console.error('Gemini batch grading fallback used:', err);
          for (const item of needsAi) {
            results.set(item.id, {
              id: item.id,
              correct: smartSemanticFallbackCheck(item.studentAnswer, item.officialAnswer),
              source: 'fallback',
              usedByok: usingByok,
            });
          }
        }
      }
    }
  }

  return items.map((it) => results.get(it.id) || { id: it.id, correct: false, source: 'fallback' });
}

// ============================================================================
// Server-Authoritative Multiplayer Room State Machine (With Monotonic roundId)
// ============================================================================

type RoomStatus = 'lobby' | 'question' | 'reveal' | 'finished';

interface PlayerAnswerRecord {
  questionIndex: number;
  roundId: string;
  answer: string;
  submittedAt: number;
  elapsedMs: number;
  gradingStatus: 'grading' | 'done';
  correct: boolean;
  gradingSource: 'local' | 'ai' | 'fallback';
  pointsAwarded: number;
  streakBonus: number;
}

interface RoomBrawlStats {
  xp: number;
  level: number;
  kills: number;
  wave: number;
  hp: number;
  maxHp: number;
  weaponCount: number;
  x?: number;
  y?: number;
  facing?: 1 | -1;
  shielded?: boolean;
}

interface RoomPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  connected: boolean;
  socket: WebSocket | null;
  answers: Map<string, PlayerAnswerRecord>;
  brawlStats: RoomBrawlStats;
}

interface QuizRoom {
  code: string;
  deckId: string;
  deckTitle: string;
  selectedSections: string[];
  timerSeconds: 15 | 20 | 30;
  gameMode: QuizGameMode;
  questionFormat: QuizQuestionFormat;
  brawlDifficulty: BrawlDifficulty;
  status: RoomStatus;
  questions: StoredQuizCard[];
  questionChoices: Map<string, string[]>;
  currentIndex: number;
  roundId: string;
  questionStartedAt: number | null;
  questionEndsAt: number | null;
  players: Map<string, RoomPlayer>;
  roundTimer: ReturnType<typeof setTimeout> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  pendingGrades: Map<string, Promise<void>>;
  lastBrawlBroadcastAt: number;
  hostAiConfig?: UserAiConfig | null;
}

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map<string, QuizRoom>();

function createDefaultBrawlStats(): RoomBrawlStats {
  return {
    xp: 0,
    level: 1,
    kills: 0,
    wave: 1,
    hp: 100,
    maxHp: 100,
    weaponCount: 1,
  };
}

function rebuildQuestionChoices(room: QuizRoom): void {
  room.questionChoices.clear();
  if (room.questionFormat !== 'mcq') return;
  room.questions.forEach((card, idx) => {
    const choices = buildMcqChoices(room.questions, idx, `${room.code}:${room.deckId}:${card.id}`);
    room.questionChoices.set(card.id, choices);
  });
}

function makeRoundId(index: number): string {
  return `r_${index}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `QZ${Math.floor(10 + Math.random() * 89)}`;
}

function makePlayerId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function shuffleCards<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function calculatePoints(elapsedMs: number, timerSeconds: number, newStreak: number): {
  basePoints: number;
  streakBonus: number;
  total: number;
} {
  const totalMs = Math.max(1000, timerSeconds * 1000);
  const clampedElapsed = Math.max(0, Math.min(totalMs, elapsedMs));
  const remainingRatio = (totalMs - clampedElapsed) / totalMs;
  const basePoints = 500 + Math.round(500 * remainingRatio);
  const streakBonus = newStreak >= 2 ? Math.min(300, (newStreak - 1) * 100) : 0;
  return {
    basePoints,
    streakBonus,
    total: basePoints + streakBonus,
  };
}

function sendJson(ws: WebSocket | null, payload: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore closed socket error
  }
}

function serializeRoomForPlayer(room: QuizRoom, viewerId: string) {
  const currentCard = room.questions[room.currentIndex] || null;
  const playersList = Array.from(room.players.values())
    .map((p) => {
      const rec = p.answers.get(room.roundId);
      return {
        id: p.id,
        nickname: p.nickname,
        isHost: p.isHost,
        score: p.score,
        streak: p.streak,
        bestStreak: p.bestStreak,
        correctCount: p.correctCount,
        connected: p.connected,
        hasSubmitted: Boolean(rec),
        gradingStatus: rec?.gradingStatus || null,
        brawlStats: room.gameMode === 'monster-brawl' ? p.brawlStats : undefined,
        lastSubmission:
          room.status === 'reveal' || room.status === 'finished'
            ? rec
              ? {
                  answer: rec.answer,
                  correct: rec.correct,
                  gradingSource: rec.gradingSource,
                  pointsAwarded: rec.pointsAwarded,
                  streakBonus: rec.streakBonus,
                  elapsedMs: rec.elapsedMs,
                }
              : null
            : p.id === viewerId && rec
            ? {
                answer: rec.answer,
                correct: false,
                gradingSource: rec.gradingSource,
                pointsAwarded: 0,
                streakBonus: 0,
                elapsedMs: rec.elapsedMs,
              }
            : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);

  const currentChoices =
    currentCard && room.questionFormat === 'mcq'
      ? room.questionChoices.get(currentCard.id) ||
        buildMcqChoices(room.questions, room.currentIndex, `${room.code}:${currentCard.id}`)
      : undefined;

  return {
    code: room.code,
    deckId: room.deckId,
    deckTitle: room.deckTitle,
    selectedSections: room.selectedSections,
    timerSeconds: room.timerSeconds,
    gameMode: room.gameMode,
    questionFormat: room.questionFormat,
    brawlDifficulty: room.brawlDifficulty,
    status: room.status,
    totalQuestions: room.questions.length,
    currentIndex: room.currentIndex,
    roundId: room.roundId,
    questionStartedAt: room.questionStartedAt,
    questionEndsAt: room.questionEndsAt,
    serverNow: Date.now(),
    currentQuestion: currentCard
      ? {
          id: currentCard.id,
          question: currentCard.question,
          section: currentCard.section,
          ...(currentChoices ? { choices: currentChoices } : {}),
          officialAnswer:
            room.status === 'reveal' || room.status === 'finished'
              ? currentCard.answer
              : undefined,
        }
      : null,
    brawlDeck:
      room.gameMode === 'monster-brawl'
        ? room.questions.map((q, idx) => ({
            id: q.id,
            question: q.question,
            section: q.section,
            ...(room.questionFormat === 'mcq'
              ? {
                  choices:
                    room.questionChoices.get(q.id) ||
                    buildMcqChoices(room.questions, idx, `${room.code}:${q.id}`),
                }
              : {}),
          }))
        : undefined,
    players: playersList,
  };
}

function broadcastRoomState(room: QuizRoom): void {
  for (const player of room.players.values()) {
    if (player.connected && player.socket) {
      sendJson(player.socket, {
        type: 'quiz:state',
        room: serializeRoomForPlayer(room, player.id),
      });
    }
  }
}

function clearRoomTimers(room: QuizRoom): void {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
}

function scheduleCleanupIfEmpty(room: QuizRoom): void {
  const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
  if (anyConnected) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    return;
  }
  if (!room.cleanupTimer) {
    room.cleanupTimer = setTimeout(() => {
      clearRoomTimers(room);
      rooms.delete(room.code);
    }, 1000 * 60 * 10);
  }
}

function finalizeScoresForRound(room: QuizRoom): void {
  for (const p of room.players.values()) {
    const rec = p.answers.get(room.roundId);
    if (!rec) {
      p.streak = 0;
    }
  }
}

async function revealRound(room: QuizRoom, expectedRoundId?: string): Promise<void> {
  if (room.status !== 'question') return;
  if (expectedRoundId && room.roundId !== expectedRoundId) return;
  const lockedRoundId = room.roundId;
  clearRoomTimers(room);

  const inFlight = Array.from(room.pendingGrades.values());
  if (inFlight.length > 0) {
    await Promise.race([
      Promise.allSettled(inFlight),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
  }

  if (room.status !== 'question' || room.roundId !== lockedRoundId) return;
  finalizeScoresForRound(room);
  room.status = 'reveal';
  room.questionEndsAt = Date.now();
  broadcastRoomState(room);
}

function checkAllPlayersDoneAndMaybeReveal(room: QuizRoom, roundId: string): void {
  if (room.status !== 'question' || room.roundId !== roundId) return;
  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
  if (connectedPlayers.length === 0) return;
  const allDone = connectedPlayers.every((p) => {
    const rec = p.answers.get(roundId);
    return rec && rec.gradingStatus === 'done';
  });
  if (allDone) {
    void revealRound(room, roundId);
  }
}

function startQuestion(room: QuizRoom, index: number): void {
  clearRoomTimers(room);
  room.pendingGrades.clear();

  if (index >= room.questions.length) {
    room.status = 'finished';
    room.questionStartedAt = null;
    room.questionEndsAt = null;
    broadcastRoomState(room);
    return;
  }

  const nextRoundId = makeRoundId(index);
  room.currentIndex = index;
  room.roundId = nextRoundId;
  room.status = 'question';
  const now = Date.now();
  room.questionStartedAt = now;
  room.questionEndsAt = now + room.timerSeconds * 1000;

  room.roundTimer = setTimeout(() => {
    void revealRound(room, nextRoundId);
  }, room.timerSeconds * 1000);

  broadcastRoomState(room);
}

function applyGradedOutcome(
  room: QuizRoom,
  player: RoomPlayer,
  rec: PlayerAnswerRecord,
  outcome: GradeOutcome
): void {
  if (rec.gradingStatus === 'done') return;
  rec.gradingStatus = 'done';
  rec.correct = outcome.correct;
  rec.gradingSource = outcome.source;

  if (outcome.correct) {
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    player.correctCount += 1;
    const pts = calculatePoints(rec.elapsedMs, room.timerSeconds, player.streak);
    rec.pointsAwarded = pts.total;
    rec.streakBonus = pts.streakBonus;
    player.score += pts.total;
  } else {
    player.streak = 0;
    rec.pointsAwarded = 0;
    rec.streakBonus = 0;
  }
}

export function attachQuizWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const rawUrl = request.url || '';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/ws/quiz') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let attachedRoomCode: string | null = null;
    let attachedPlayerId: string | null = null;

    const detachFromCurrentRoom = () => {
      if (!attachedRoomCode || !attachedPlayerId) return;
      const room = rooms.get(attachedRoomCode);
      if (room) {
        const player = room.players.get(attachedPlayerId);
        if (player && player.socket === ws) {
          player.connected = false;
          player.socket = null;
          broadcastRoomState(room);
          scheduleCleanupIfEmpty(room);
        }
      }
      attachedRoomCode = null;
      attachedPlayerId = null;
    };

    ws.on('message', async (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString()) as Record<string, unknown>;
      } catch {
        sendJson(ws, { type: 'quiz:error', message: 'Invalid WebSocket payload.' });
        return;
      }

      const type = String(msg.type || '');

      if (type === 'quiz:ping') {
        sendJson(ws, { type: 'quiz:pong', serverNow: Date.now() });
        return;
      }

      if (type === 'quiz:create') {
        const deckId = String(msg.deckId || '').trim();
        const nickname = String(msg.nickname || '').trim().slice(0, 24);
        const rawTimer = Number(msg.timerSeconds || 20);
        const timerSeconds: 15 | 20 | 30 =
          rawTimer === 15 ? 15 : rawTimer === 30 ? 30 : 20;
        const gameMode: QuizGameMode =
          msg.gameMode === 'monster-brawl' ? 'monster-brawl' : 'classic';
        const questionFormat: QuizQuestionFormat =
          msg.questionFormat === 'mcq' ? 'mcq' : 'typed';
        const brawlDifficulty: BrawlDifficulty = normalizeBrawlDifficulty(msg.brawlDifficulty);
        const selectedSections = Array.isArray(msg.selectedSections)
          ? msg.selectedSections.map((s) => String(s || '').trim()).filter(Boolean)
          : [];
        const inlineCardsRaw = Array.isArray(msg.inlineCards) ? msg.inlineCards : null;
        const inlineDeckTitle = String(msg.inlineDeckTitle || '').trim();

        if (!nickname) {
          sendJson(ws, { type: 'quiz:error', message: 'Enter your host nickname first.' });
          return;
        }

        let resolvedDeckId = deckId || `live_${Date.now().toString(36)}`;
        let resolvedDeckTitle = inlineDeckTitle || 'Current Flashcards';
        let cards: StoredQuizCard[] = [];

        if (inlineCardsRaw && inlineCardsRaw.length > 0) {
          cards = inlineCardsRaw
            .map((raw, idx) => {
              const item = raw as {
                question?: unknown;
                answer?: unknown;
                section?: unknown;
                options?: unknown;
              };
              const q = String(item?.question || '').trim();
              const a = String(item?.answer || '').trim();
              const sec = String(item?.section || '').trim() || 'General';
              const opts = Array.isArray(item?.options)
                ? item.options.map((x) => String(x || '').trim()).filter(Boolean)
                : undefined;
              return {
                id: `inline_${idx}_${Date.now().toString(36)}`,
                deckId: resolvedDeckId,
                question: q,
                answer: a,
                section: sec,
                position: idx,
                ...(opts && opts.length >= 2 ? { options: opts } : {}),
              };
            })
            .filter((c) => c.question && c.answer);
        } else {
          const deck = getDeckById(deckId);
          if (!deck) {
            sendJson(ws, {
              type: 'quiz:error',
              message: 'Selected deck was not found. Pick a saved deck or current flashcards.',
            });
            return;
          }
          resolvedDeckId = deck.id;
          resolvedDeckTitle = deck.title;
          const secFilter = new Set(selectedSections);
          cards =
            secFilter.size > 0
              ? deck.cards.filter((c) => secFilter.has(c.section))
              : deck.cards;
        }

        if (!cards.length) {
          sendJson(ws, {
            type: 'quiz:error',
            message: 'Select at least one section containing flashcards.',
          });
          return;
        }

        detachFromCurrentRoom();

        const code = generateRoomCode();
        const hostId = makePlayerId();
        const activeSections = Array.from(new Set(cards.map((c) => c.section)));

        const hostPlayer: RoomPlayer = {
          id: hostId,
          nickname,
          isHost: true,
          score: 0,
          streak: 0,
          bestStreak: 0,
          correctCount: 0,
          connected: true,
          socket: ws,
          answers: new Map(),
          brawlStats: createDefaultBrawlStats(),
        };

        const hostAiConfig = parseUserAiConfig(msg.byok);

        const room: QuizRoom = {
          code,
          deckId: resolvedDeckId,
          deckTitle: resolvedDeckTitle,
          selectedSections: activeSections,
          timerSeconds,
          gameMode,
          questionFormat,
          brawlDifficulty,
          status: 'lobby',
          questions: shuffleCards(cards),
          questionChoices: new Map(),
          currentIndex: 0,
          roundId: makeRoundId(-1),
          questionStartedAt: null,
          questionEndsAt: null,
          players: new Map([[hostId, hostPlayer]]),
          roundTimer: null,
          cleanupTimer: null,
          pendingGrades: new Map(),
          lastBrawlBroadcastAt: 0,
          hostAiConfig,
        };
        rebuildQuestionChoices(room);

        rooms.set(code, room);
        attachedRoomCode = code;
        attachedPlayerId = hostId;

        sendJson(ws, {
          type: 'quiz:joined',
          code,
          playerId: hostId,
          isHost: true,
          room: serializeRoomForPlayer(room, hostId),
        });
        return;
      }

      if (type === 'quiz:join') {
        const code = String(msg.code || '').trim().toUpperCase();
        const nickname = String(msg.nickname || '').trim().slice(0, 24);
        const prevPlayerId = typeof msg.playerId === 'string' ? msg.playerId : '';

        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'quiz:error',
            message: `No active quiz room found with code "${code}".`,
          });
          return;
        }

        if (prevPlayerId && room.players.has(prevPlayerId)) {
          detachFromCurrentRoom();
          const existing = room.players.get(prevPlayerId)!;
          existing.connected = true;
          existing.socket = ws;
          if (nickname) existing.nickname = nickname;
          attachedRoomCode = code;
          attachedPlayerId = existing.id;
          scheduleCleanupIfEmpty(room);

          sendJson(ws, {
            type: 'quiz:joined',
            code,
            playerId: existing.id,
            isHost: existing.isHost,
            room: serializeRoomForPlayer(room, existing.id),
          });
          broadcastRoomState(room);
          return;
        }

        if (!nickname) {
          sendJson(ws, { type: 'quiz:error', message: 'Enter a nickname to join.' });
          return;
        }

        const disconnectedSameName = Array.from(room.players.values()).find(
          (p) => !p.connected && p.nickname.toLowerCase() === nickname.toLowerCase()
        );
        if (disconnectedSameName) {
          detachFromCurrentRoom();
          disconnectedSameName.connected = true;
          disconnectedSameName.socket = ws;
          attachedRoomCode = code;
          attachedPlayerId = disconnectedSameName.id;
          scheduleCleanupIfEmpty(room);

          sendJson(ws, {
            type: 'quiz:joined',
            code,
            playerId: disconnectedSameName.id,
            isHost: disconnectedSameName.isHost,
            room: serializeRoomForPlayer(room, disconnectedSameName.id),
          });
          broadcastRoomState(room);
          return;
        }

        const duplicateName = Array.from(room.players.values()).some(
          (p) => p.connected && p.nickname.toLowerCase() === nickname.toLowerCase()
        );
        if (duplicateName) {
          sendJson(ws, {
            type: 'quiz:error',
            message: `Nickname "${nickname}" is already taken in room ${code}.`,
          });
          return;
        }

        detachFromCurrentRoom();
        const playerId = makePlayerId();
        const player: RoomPlayer = {
          id: playerId,
          nickname,
          isHost: false,
          score: 0,
          streak: 0,
          bestStreak: 0,
          correctCount: 0,
          connected: true,
          socket: ws,
          answers: new Map(),
          brawlStats: createDefaultBrawlStats(),
        };
        room.players.set(playerId, player);
        attachedRoomCode = code;
        attachedPlayerId = playerId;
        scheduleCleanupIfEmpty(room);

        sendJson(ws, {
          type: 'quiz:joined',
          code,
          playerId,
          isHost: false,
          room: serializeRoomForPlayer(room, playerId),
        });
        broadcastRoomState(room);
        return;
      }

      if (!attachedRoomCode || !attachedPlayerId) {
        sendJson(ws, { type: 'quiz:error', message: 'Join or create a quiz room first.' });
        return;
      }
      const room = rooms.get(attachedRoomCode);
      const player = room?.players.get(attachedPlayerId);
      if (!room || !player) {
        sendJson(ws, { type: 'quiz:error', message: 'Room no longer exists.' });
        return;
      }

      if (type === 'quiz:leave') {
        const wasHost = player.isHost;
        room.players.delete(player.id);
        attachedRoomCode = null;
        attachedPlayerId = null;
        if (wasHost) {
          const nextHost = Array.from(room.players.values()).find((p) => p.connected);
          if (nextHost) nextHost.isHost = true;
        }
        broadcastRoomState(room);
        scheduleCleanupIfEmpty(room);
        return;
      }

      if (type === 'quiz:start') {
        if (!player.isHost) {
          sendJson(ws, { type: 'quiz:error', message: 'Only the Host can start the game.' });
          return;
        }
        if (room.status !== 'lobby') return;
        if (room.gameMode === 'monster-brawl') {
          clearRoomTimers(room);
          room.pendingGrades.clear();
          room.status = 'question';
          room.currentIndex = 0;
          room.roundId = makeRoundId(0);
          room.questionStartedAt = Date.now();
          room.questionEndsAt = null;
          broadcastRoomState(room);
          return;
        }
        startQuestion(room, 0);
        return;
      }

      if (type === 'quiz:finish-brawl') {
        if (!player.isHost || room.gameMode !== 'monster-brawl') return;
        clearRoomTimers(room);
        room.status = 'finished';
        room.questionEndsAt = Date.now();
        broadcastRoomState(room);
        return;
      }

      if (type === 'quiz:brawl-world') {
        if (room.gameMode !== 'monster-brawl' || room.status !== 'question' || !player.isHost) return;
        for (const p of room.players.values()) {
          if (p.id !== player.id && p.connected && p.socket) {
            sendJson(p.socket, { type: 'quiz:brawl-world', world: msg.world });
          }
        }
        return;
      }

      if (type === 'quiz:brawl-hero') {
        if (room.gameMode !== 'monster-brawl' || room.status !== 'question') return;
        const heroObj =
          msg.hero && typeof msg.hero === 'object' ? (msg.hero as Record<string, unknown>) : {};
        const payload = {
          type: 'quiz:brawl-hero',
          hero: {
            ...heroObj,
            playerId: player.id,
            nickname: player.nickname,
          },
        };
        for (const p of room.players.values()) {
          if (p.id !== player.id && p.connected && p.socket) {
            sendJson(p.socket, payload);
          }
        }
        return;
      }

      if (type === 'quiz:brawl-action') {
        if (room.gameMode !== 'monster-brawl' || room.status !== 'question') return;
        const actionObj =
          msg.action && typeof msg.action === 'object'
            ? (msg.action as Record<string, unknown>)
            : {};
        const payload = {
          type: 'quiz:brawl-action',
          action: {
            ...actionObj,
            playerId: player.id,
          },
        };
        for (const p of room.players.values()) {
          if (p.id !== player.id && p.connected && p.socket) {
            sendJson(p.socket, payload);
          }
        }
        return;
      }

      if (type === 'quiz:brawl-progress') {
        if (room.gameMode !== 'monster-brawl' || room.status !== 'question') return;
        const rawStats = (msg.stats || {}) as Record<string, unknown>;
        const nextXp = Math.max(0, Math.min(500000, Math.round(Number(rawStats.xp) || 0)));
        const nextLevel = Math.max(1, Math.min(99, Math.round(Number(rawStats.level) || 1)));
        const nextKills = Math.max(0, Math.min(100000, Math.round(Number(rawStats.kills) || 0)));
        const nextWave = Math.max(1, Math.min(999, Math.round(Number(rawStats.wave) || 1)));
        const nextMaxHp = Math.max(50, Math.min(1000, Math.round(Number(rawStats.maxHp) || 100)));
        const nextHp = Math.max(0, Math.min(nextMaxHp, Math.round(Number(rawStats.hp) || 0)));
        const nextWeapons = Math.max(1, Math.min(12, Math.round(Number(rawStats.weaponCount) || 1)));
        const nextX = typeof rawStats.x === 'number' ? Math.round(rawStats.x) : undefined;
        const nextY = typeof rawStats.y === 'number' ? Math.round(rawStats.y) : undefined;
        const nextFacing = rawStats.facing === -1 ? -1 : rawStats.facing === 1 ? 1 : undefined;
        const nextShielded = typeof rawStats.shielded === 'boolean' ? rawStats.shielded : undefined;

        const prevWave = player.brawlStats.wave;
        const prevLevel = player.brawlStats.level;
        player.brawlStats = {
          xp: nextXp,
          level: nextLevel,
          kills: nextKills,
          wave: nextWave,
          hp: nextHp,
          maxHp: nextMaxHp,
          weaponCount: nextWeapons,
          ...(nextX !== undefined ? { x: nextX } : {}),
          ...(nextY !== undefined ? { y: nextY } : {}),
          ...(nextFacing !== undefined ? { facing: nextFacing } : {}),
          ...(nextShielded !== undefined ? { shielded: nextShielded } : {}),
        };
        const computedScore = nextXp + nextKills * 25 + player.correctCount * 150;
        if (computedScore > player.score) {
          player.score = computedScore;
        }

        const now = Date.now();
        if (
          now - room.lastBrawlBroadcastAt >= 850 ||
          nextWave !== prevWave ||
          nextLevel !== prevLevel
        ) {
          room.lastBrawlBroadcastAt = now;
          broadcastRoomState(room);
        }
        return;
      }

      if (type === 'quiz:brawl-answer') {
        if (room.gameMode !== 'monster-brawl' || room.status !== 'question') return;
        const questionId = String(msg.questionId || '');
        const requestId = String(msg.requestId || '');
        const answerText = String(msg.answer || '').trim();
        const card = room.questions.find((q) => q.id === questionId) || room.questions[0];
        if (!card) return;

        let outcome: GradeOutcome;
        if (!answerText) {
          outcome = { correct: false, source: 'local', latencyMs: 0 };
        } else if (room.questionFormat === 'mcq') {
          outcome = {
            correct: isMcqSelectionCorrect(answerText, card.answer),
            source: 'local',
            latencyMs: 0,
          };
        } else if (fastLocalQuizCheck(answerText, card.answer)) {
          outcome = { correct: true, source: 'local', latencyMs: 0 };
        } else {
          const playerAiConfig = parseUserAiConfig(msg.byok);
          outcome = await gradeSingleAnswer(
            card.question,
            card.answer,
            answerText,
            playerAiConfig || room.hostAiConfig || null
          );
        }

        let pointsAwarded = 0;
        if (outcome.correct) {
          player.streak += 1;
          player.bestStreak = Math.max(player.bestStreak, player.streak);
          player.correctCount += 1;
          pointsAwarded = 150 + Math.min(200, (player.streak - 1) * 50);
          player.score += pointsAwarded;
        } else {
          player.streak = 0;
        }

        sendJson(ws, {
          type: 'quiz:brawl-graded',
          requestId,
          questionId: card.id,
          correct: outcome.correct,
          officialAnswer: card.answer,
          pointsAwarded,
          streak: player.streak,
          gradingSource: outcome.source,
        });
        broadcastRoomState(room);
        return;
      }

      if (type === 'quiz:reveal') {
        if (!player.isHost || room.gameMode === 'monster-brawl') return;
        await revealRound(room, room.roundId);
        return;
      }

      if (type === 'quiz:next') {
        if (!player.isHost || room.gameMode === 'monster-brawl') return;
        const expectedRoundId = typeof msg.roundId === 'string' ? msg.roundId : room.roundId;
        if (expectedRoundId !== room.roundId) return;
        if (room.status === 'question') {
          await revealRound(room, expectedRoundId);
          return;
        }
        if (room.status === 'reveal') {
          startQuestion(room, room.currentIndex + 1);
        }
        return;
      }

      if (type === 'quiz:restart') {
        if (!player.isHost) return;
        clearRoomTimers(room);
        room.pendingGrades.clear();
        room.status = 'lobby';
        room.currentIndex = 0;
        room.roundId = makeRoundId(-1);
        room.questionStartedAt = null;
        room.questionEndsAt = null;
        room.questions = shuffleCards(room.questions);
        rebuildQuestionChoices(room);
        for (const p of room.players.values()) {
          p.score = 0;
          p.streak = 0;
          p.bestStreak = 0;
          p.correctCount = 0;
          p.answers.clear();
          p.brawlStats = createDefaultBrawlStats();
        }
        broadcastRoomState(room);
        return;
      }

      if (type === 'quiz:submit') {
        if (room.status !== 'question' || room.gameMode === 'monster-brawl') return;
        const qIdx = room.currentIndex;
        const lockedRoundId = room.roundId;
        if (player.answers.has(lockedRoundId)) return;

        const card = room.questions[qIdx];
        if (!card) return;

        const submittedAt = Date.now();
        const elapsedMs = Math.max(0, submittedAt - (room.questionStartedAt || submittedAt));
        const answerText = String(msg.answer || '').trim();

        if (!answerText) {
          const rec: PlayerAnswerRecord = {
            questionIndex: qIdx,
            roundId: lockedRoundId,
            answer: '',
            submittedAt,
            elapsedMs,
            gradingStatus: 'done',
            correct: false,
            gradingSource: 'local',
            pointsAwarded: 0,
            streakBonus: 0,
          };
          player.answers.set(lockedRoundId, rec);
          player.streak = 0;
          broadcastRoomState(room);
          checkAllPlayersDoneAndMaybeReveal(room, lockedRoundId);
          return;
        }

        // Fast 0ms grading for Multiple Choice or exact/local match
        const isMcqCorrect =
          room.questionFormat === 'mcq' ? isMcqSelectionCorrect(answerText, card.answer) : false;
        if (room.questionFormat === 'mcq' || fastLocalQuizCheck(answerText, card.answer)) {
          const rec: PlayerAnswerRecord = {
            questionIndex: qIdx,
            roundId: lockedRoundId,
            answer: answerText,
            submittedAt,
            elapsedMs,
            gradingStatus: 'grading',
            correct: false,
            gradingSource: 'local',
            pointsAwarded: 0,
            streakBonus: 0,
          };
          applyGradedOutcome(room, player, rec, {
            correct: room.questionFormat === 'mcq' ? isMcqCorrect : true,
            source: 'local',
            latencyMs: 0,
          });
          player.answers.set(lockedRoundId, rec);
          broadcastRoomState(room);
          checkAllPlayersDoneAndMaybeReveal(room, lockedRoundId);
          return;
        }

        const rec: PlayerAnswerRecord = {
          questionIndex: qIdx,
          roundId: lockedRoundId,
          answer: answerText,
          submittedAt,
          elapsedMs,
          gradingStatus: 'grading',
          correct: false,
          gradingSource: 'ai',
          pointsAwarded: 0,
          streakBonus: 0,
        };
        player.answers.set(lockedRoundId, rec);
        broadcastRoomState(room);

        const playerAiConfig = parseUserAiConfig(msg.byok);
        const effectiveAiConfig = playerAiConfig || room.hostAiConfig || null;

        const gradeKey = `${lockedRoundId}:${player.id}`;
        const gradePromise = (async () => {
          const outcome = await gradeSingleAnswer(
            card.question,
            card.answer,
            answerText,
            effectiveAiConfig
          );
          if (
            room.roundId === lockedRoundId &&
            (room.status === 'question' || room.status === 'reveal')
          ) {
            applyGradedOutcome(room, player, rec, outcome);
          }
        })().finally(() => {
          room.pendingGrades.delete(gradeKey);
          if (room.roundId === lockedRoundId && room.status === 'question') {
            broadcastRoomState(room);
            checkAllPlayersDoneAndMaybeReveal(room, lockedRoundId);
          }
        });

        room.pendingGrades.set(gradeKey, gradePromise);
      }
    });

    ws.on('close', () => {
      detachFromCurrentRoom();
    });
  });

  return wss;
}

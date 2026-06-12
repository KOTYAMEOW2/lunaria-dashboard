import type { StalcraftCharacterCacheRow } from "@/lib/stalcraft/types";

export type GearScreenshotSearchResult = {
  itemId: string;
  itemName: string;
  itemNameRu?: string | null;
  itemNameEn?: string | null;
  slot: "weapon" | "armor";
  category: string;
  rank: string | null;
  wikiUrl: string;
  exact: boolean;
  score: number;
};

export type OcrTextResult = {
  key: string;
  mode: "nick" | "item" | "full";
  text: string;
  priority: number;
  slotHint?: "weapon" | "armor" | null;
};

export type NicknameMatch = {
  score: number;
  line: string;
  character: StalcraftCharacterCacheRow;
};

export type ItemMatch = {
  score: number;
  line: string;
  slot: "weapon" | "armor";
  item: GearScreenshotSearchResult;
  exact: boolean;
};

export type GearScreenshotAnalysis = {
  nicknameMatch: NicknameMatch | null;
  itemMatch: ItemMatch | null;
  recognized: OcrTextResult[];
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function normalizeNickname(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s_.\-]+/g, "")
    .replace(/[^a-z0-9а-я]+/gi, "")
    .trim();
}

function boundedLevenshtein(a: string, b: string, maxDistance = 3) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return null;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    let rowMin = next[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, next[j]);
    }

    if (rowMin > maxDistance) return null;
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }

  return prev[b.length] <= maxDistance ? prev[b.length] : null;
}

export function scoreNicknameMatch(candidate: string, target: string) {
  const left = normalizeNickname(candidate);
  const right = normalizeNickname(target);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (left.includes(right) || right.includes(left)) return 900 - Math.abs(left.length - right.length) * 20;

  const distance = boundedLevenshtein(left, right, 3);
  if (distance !== null) return 760 - distance * 80;
  return 0;
}

export function splitLines(text: string) {
  return String(text || "")
    .split(/\r?\n/g)
    .map((line) => cleanText(line))
    .filter(Boolean) as string[];
}

function uniq<T>(values: T[]) {
  return [...new Set(values)];
}

export function cleanItemCandidate(value: string) {
  return String(value || "")
    .replace(/\|\s*\+\d+.*$/u, "")
    .replace(/\+\d+.*$/u, "")
    .replace(/[|¦]+.*$/u, "")
    .replace(/^[^\p{L}\p{N}«"<]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulItemLine(value: string) {
  const line = cleanItemCandidate(value);
  if (!line || line.length < 3) return false;
  if (/^(персональный предмет|ранг|класс|вес|прочность|владелец|итоговые характеристики|урон|тип боеприпасов|объем магазина|магазина|скорострельность|перезарядка|тактическая перезарядка|эргономика оружия|разброс|вертикальная отдача|горизонтальная отдача|скорость передвижения|выносливость|стойкость)$/i.test(line)) {
    return false;
  }
  return /[a-zа-я0-9]/i.test(line);
}

export function isWeakShortLatinCandidate(value: string) {
  const line = cleanItemCandidate(value);
  if (!line) return false;
  const compact = line.replace(/\s+/g, "");
  return compact.length <= 4 && /^[a-z]+$/i.test(compact);
}

export function matchNickname(recognized: OcrTextResult[], characters: StalcraftCharacterCacheRow[]) {
  const lines = recognized
    .filter((entry) => entry.mode === "nick" || entry.mode === "full")
    .flatMap((entry) => splitLines(entry.text));

  let best: NicknameMatch | null = null;
  for (const line of uniq(lines)) {
    for (const character of characters) {
      const score = scoreNicknameMatch(line, character.character_name);
      if (!best || score > best.score) {
        best = { score, line, character };
      }
    }
  }

  return best && best.score >= 720 ? best : null;
}

export async function matchItem(
  recognized: OcrTextResult[],
  searchOfficial: (query: string, slot?: "weapon" | "armor" | null) => Promise<GearScreenshotSearchResult[]>,
  slotHint: "weapon" | "armor" | null,
) {
  const lines = recognized
    .filter((entry) => entry.mode === "item" || entry.mode === "full")
    .flatMap((entry) => splitLines(entry.text).map((line) => ({
      key: entry.key,
      slotHint: entry.slotHint ?? null,
      priority: entry.priority || 0,
      line: cleanItemCandidate(line),
    })))
    .filter((entry) => isUsefulItemLine(entry.line))
    .sort((left, right) => right.priority - left.priority);

  let best: ItemMatch | null = null;
  const slots = slotHint ? [slotHint] : (["weapon", "armor"] as const);

  for (const candidate of lines) {
    const line = candidate.line;
    const shortLatin = isWeakShortLatinCandidate(line);
    const keyLower = candidate.key.toLowerCase();
    const isTitleCandidate = keyLower.includes("title");

    if (shortLatin && !isTitleCandidate) continue;

    for (const slot of slots) {
      let candidateScore = candidate.priority || 0;
      if (candidate.slotHint && candidate.slotHint !== slot) candidateScore -= 220;
      if (shortLatin) candidateScore -= isTitleCandidate ? 40 : 220;
      if (keyLower.includes("full")) candidateScore -= 180;
      if (/[«»]/u.test(line) || /\+\d+/u.test(line)) candidateScore += 60;
      if (/[а-я]/iu.test(line)) candidateScore += 30;

      const matches = await searchOfficial(line, slot);
      const top = matches[0];
      if (!top) continue;

      const totalScore = top.score + candidateScore;
      if (!best || totalScore > best.score) {
        best = {
          score: totalScore,
          line,
          slot,
          item: top,
          exact: top.exact,
        };
      }
    }
  }

  return best && best.score >= 860 ? best : null;
}

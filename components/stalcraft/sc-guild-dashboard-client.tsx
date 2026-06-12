"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";

import type { ScGuildDashboardData } from "@/lib/stalcraft/sc-dashboard";
import { sanitizeCwRows, toInt, type CwResultRow } from "@/lib/stalcraft/cw-ocr-core";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export type ScDashboardSection = "overview" | "settings" | "attendance" | "squads" | "tabs";

type Props = {
  guildId: string;
  data: ScGuildDashboardData;
  activeSection: ScDashboardSection;
};

const roleKeys = [
  ["clan_member", "Клановая роль"],
  ["verified", "SC Verified"],
  ["cw_participant", "КВ: Участвует"],
  ["leader", "SC Лидер"],
  ["colonel", "SC Полковник"],
  ["officer", "SC Офицер"],
] as const;

const navItems: Array<[ScDashboardSection, string, string]> = [
  ["overview", "Обзор штаба", ""],
  ["settings", "Настройки", "settings"],
  ["attendance", "Посещения", "attendance"],
  ["squads", "Отряды КВ", "squads"],
  ["tabs", "Табы КВ", "cw-tabs"],
];

const MAX_CW_SQUADS = 7;

const OCR_IGNORED_ROW = /^(сводка|преимущество|захваченные|информация|ник|игрок|player|name|kills?|убийств|смерт|death|assist|казна|score|счет|счёт|ранг|k\/d|у\s+с\s+п)/i;

function parseFloatStat(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isGroupedInteger(parts: string[]) {
  return parts.every((part, index) => /^\d+$/.test(part) && (index === 0 ? part.length <= 3 : part.length === 3));
}

function groupedInt(parts: string[]) {
  return toInt(parts.join(""));
}

function normalizeOcrNumberToken(value: string) {
  return String(value || "")
    .replace(/[OoОо]/g, "0")
    .replace(/[IlІ|]/g, "1")
    .replace(/[Зз]/g, "3")
    .replace(/[Бб]/g, "6")
    .replace(/[^\d]/g, "");
}

function isOcrIntegerToken(value: string | undefined) {
  const normalized = normalizeOcrNumberToken(value || "");
  return normalized.length > 0 && normalized.length === String(value || "").replace(/[^\dOoОоIlІ|ЗзБб]/g, "").length;
}

function buildPartitions(tokens: string[], groupsLeft: number, maxGroupSize: number): string[][][] {
  if (groupsLeft === 0) return tokens.length === 0 ? [[]] : [];
  const minRemaining = groupsLeft - 1;
  const maxSize = Math.min(maxGroupSize, tokens.length - minRemaining);
  const result: string[][][] = [];

  for (let size = 1; size <= maxSize; size += 1) {
    const group = tokens.slice(0, size);
    if (!isGroupedInteger(group)) continue;
    for (const tail of buildPartitions(tokens.slice(size), groupsLeft - 1, maxGroupSize)) {
      result.push([group, ...tail]);
    }
  }

  return result;
}

function scoreOcrCandidate(values: number[], kd: number | null, kda: number | null) {
  const [matches, kills, deaths, assists, treasury, score] = values;
  let penalty = 0;

  if (matches < 0 || matches > 10000) penalty += 500;
  if (kills > 100000 || deaths > 100000 || assists > 100000) penalty += 250;
  if (treasury > 999999999 || score > 999999999) penalty += 250;

  if (kd !== null) {
    const current = deaths === 0 ? (kills > 0 ? 99 : 0) : kills / deaths;
    penalty += Math.abs(Math.min(current, 99) - kd) * 30;
  }

  if (kda !== null) {
    const current = deaths === 0 ? (kills + assists > 0 ? 99 : 0) : (kills + assists) / deaths;
    penalty += Math.abs(Math.min(current, 99) - kda) * 20;
  }

  return penalty;
}

function scoreStalcraftTabCandidate(values: number[]) {
  const [kills, deaths, assists, treasury, score] = values;
  let penalty = 0;

  if (kills < 0 || kills > 1000) penalty += 400;
  if (deaths < 0 || deaths > 1000) penalty += 400;
  if (assists < 0 || assists > 1000) penalty += 400;
  if (treasury < 0 || treasury > 999999999) penalty += 250;
  if (score < 0 || score > 999999999) penalty += 250;
  if (treasury < Math.max(kills, deaths, assists) && score > treasury) penalty += 80;

  return penalty;
}

function parseOcrNumbers(rawNumbers: string[]) {
  const decimalTail = rawNumbers.filter((token) => /[,.]/.test(token)).slice(-2);
  const kd = parseFloatStat(decimalTail[0]);
  const kda = parseFloatStat(decimalTail[1]);
  const integerTokens = rawNumbers.filter((token) => !/[,.]/.test(token));

  if (integerTokens.length < 6) return null;

  const partitionCandidates = buildPartitions(integerTokens, 6, 3)
    .map((partition) => partition.map(groupedInt))
    .map((values) => ({
      values,
      score: scoreOcrCandidate(values, kd, kda),
    }))
    .sort((a, b) => a.score - b.score);

  const best = partitionCandidates[0]?.values;
  if (!best) return null;

  return {
    matches_count: Math.max(1, best[0] || 1),
    kills: best[1] || 0,
    deaths: best[2] || 0,
    assists: best[3] || 0,
    treasury_spent: best[4] || 0,
    score: best[5] || 0,
  };
}

function parseStalcraftScoreboardLine(line: string): CwResultRow | null {
  const normalized = line
    .replace(/[|¦]/g, " ")
    .replace(/[^\p{L}\p{N}\s_[\].#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const tokens = normalized.split(/\s+/);
  if (/^(?:#|№)?[\dOoОоIlІ|]{1,3}$/.test(tokens[0] || "")) {
    tokens.shift();
  }

  while (tokens.length > 0 && !isOcrIntegerToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length < 6) return null;

  let numericStart = tokens.length;
  while (numericStart > 0 && isOcrIntegerToken(tokens[numericStart - 1])) {
    numericStart -= 1;
  }

  const nameTokens = tokens.slice(0, numericStart);
  const numericTokens = tokens.slice(numericStart).map(normalizeOcrNumberToken).filter(Boolean);
  if (nameTokens.length === 0 || numericTokens.length < 5) return null;

  const character_name = nameTokens
    .join(" ")
    .replace(/[^\p{L}\p{N}\s_[\].#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!character_name || character_name.length < 2) return null;

  const partitionCandidates = buildPartitions(numericTokens, 5, 3)
    .map((partition) => partition.map(groupedInt))
    .map((values) => ({ values, score: scoreStalcraftTabCandidate(values) }))
    .sort((a, b) => a.score - b.score);

  const best = partitionCandidates[0]?.values;
  if (!best) return null;

  return {
    character_name,
    matches_count: 1,
    kills: best[0] || 0,
    deaths: best[1] || 0,
    assists: best[2] || 0,
    treasury_spent: best[3] || 0,
    score: best[4] || 0,
  };
}

// ─── Table column detector (hybrid) ──────────────────────────────────────────

type TableBounds = { x: number; width: number }; // fractions of canvas width
type OcrCanvasMode = "threshold" | "contrast" | "whiteText" | "whiteTextSoft";

const STALCRAFT_FIXED_ROW_CROPS = [
  { label: "stalcraft fixed tight", x: 0.335, y: 0.19, width: 0.605, height: 0.23 },
  { label: "stalcraft fixed relaxed", x: 0.325, y: 0.18, width: 0.62, height: 0.245 },
  { label: "stalcraft tall table", x: 0.305, y: 0.035, width: 0.685, height: 0.555 },
  { label: "stalcraft tall relaxed", x: 0.295, y: 0.03, width: 0.695, height: 0.575 },
] as const;
const STALCRAFT_AI_TABLE_CROP = { x: 0.295, y: 0.03, width: 0.695, height: 0.575 } as const;

const STALCRAFT_FIXED_COLUMN_LAYOUTS = [
  {
    label: "base",
    columns: [
      { key: "name", x: 0.03, width: 0.435, kind: "name" },
      { key: "kills", x: 0.468, width: 0.062, kind: "number" },
      { key: "deaths", x: 0.548, width: 0.062, kind: "number" },
      { key: "assists", x: 0.628, width: 0.062, kind: "number" },
      { key: "treasury", x: 0.715, width: 0.112, kind: "number" },
      { key: "score", x: 0.832, width: 0.078, kind: "number" },
    ],
  },
  {
    label: "shifted right",
    columns: [
      { key: "name", x: 0.028, width: 0.455, kind: "name" },
      { key: "kills", x: 0.495, width: 0.056, kind: "number" },
      { key: "deaths", x: 0.575, width: 0.056, kind: "number" },
      { key: "assists", x: 0.655, width: 0.056, kind: "number" },
      { key: "treasury", x: 0.742, width: 0.104, kind: "number" },
      { key: "score", x: 0.853, width: 0.068, kind: "number" },
    ],
  },
  {
    label: "wide name",
    columns: [
      { key: "name", x: 0.02, width: 0.472, kind: "name" },
      { key: "kills", x: 0.505, width: 0.052, kind: "number" },
      { key: "deaths", x: 0.585, width: 0.052, kind: "number" },
      { key: "assists", x: 0.665, width: 0.052, kind: "number" },
      { key: "treasury", x: 0.748, width: 0.1, kind: "number" },
      { key: "score", x: 0.852, width: 0.07, kind: "number" },
    ],
  },
  {
    label: "tall compact",
    columns: [
      { key: "name", x: 0.028, width: 0.445, kind: "name" },
      { key: "kills", x: 0.488, width: 0.055, kind: "number" },
      { key: "deaths", x: 0.568, width: 0.055, kind: "number" },
      { key: "assists", x: 0.648, width: 0.055, kind: "number" },
      { key: "treasury", x: 0.736, width: 0.098, kind: "number" },
      { key: "score", x: 0.846, width: 0.074, kind: "number" },
    ],
  },
  {
    label: "tall wide name",
    columns: [
      { key: "name", x: 0.022, width: 0.468, kind: "name" },
      { key: "kills", x: 0.502, width: 0.05, kind: "number" },
      { key: "deaths", x: 0.58, width: 0.05, kind: "number" },
      { key: "assists", x: 0.658, width: 0.05, kind: "number" },
      { key: "treasury", x: 0.742, width: 0.094, kind: "number" },
      { key: "score", x: 0.848, width: 0.072, kind: "number" },
    ],
  },
] as const;

const STALCRAFT_FIXED_ROW_LAYOUTS = [
  { label: "10 rows", top: 0.018, height: 0.95, rows: 10 },
  { label: "10 rows lower", top: 0.03, height: 0.94, rows: 10 },
  { label: "11 rows", top: 0.01, height: 0.96, rows: 11 },
  { label: "16 rows", top: 0.012, height: 0.968, rows: 16 },
  { label: "17 rows", top: 0.012, height: 0.968, rows: 17 },
  { label: "18 rows", top: 0.012, height: 0.968, rows: 18 },
] as const;

/**
 * Scans a canvas for vertical grid lines (column separators) in a STALCRAFT tab.
 * Returns array of {x, width} column bounds as fractions [0..1].
 * Returns null if no reliable columns detected (falls back to line-parsing).
 */
function detectTableColumns(canvas: HTMLCanvasElement): TableBounds[] | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  // Sample every 4px horizontally to find dense dark vertical stripes
  const stride = 4;
  const colDensity = new Float32Array(Math.ceil(w / stride));

  for (let x = 0; x < w; x += stride) {
    const colData = ctx.getImageData(x, 0, 1, h).data;
    let dark = 0;
    for (let y = 0; y < h; y += 2) {
      const gray = colData[y * 4] * 0.299 + colData[y * 4 + 1] * 0.587 + colData[y * 4 + 2] * 0.114;
      if (gray < 80) dark++;
    }
    colDensity[Math.floor(x / stride)] = dark / (h / 2);
  }

  // Smooth
  const smoothed = new Float32Array(colDensity.length);
  const kernel = 3;
  for (let i = 0; i < colDensity.length; i++) {
    let sum = 0, count = 0;
    for (let k = -kernel; k <= kernel; k++) {
      const j = i + k;
      if (j >= 0 && j < colDensity.length) { sum += colDensity[j]; count++; }
    }
    smoothed[i] = sum / count;
  }

  // Find peaks — local maxima above threshold (strong vertical lines)
  const threshold = 0.45; // at least 45% dark pixels in column
  const minGap = 6; // at least 6 stride-steps between columns (~24px at 1080p)
  const peaks: number[] = [];

  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > threshold && smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) {
      // Only accept if it's a sharp peak (not a noisy plateau)
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGap) {
        peaks.push(i);
      }
    }
  }

  // Need at least 4 lines (5 columns) to be a table
  if (peaks.length < 4) return null;

  // Keep the sharpest lines: top 60% by density, min 6 lines, max 20
  const top = peaks
    .map((i) => ({ i, d: smoothed[i] }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 20)
    .sort((a, b) => a.i - b.i);

  if (top.length < 6) return null;

  // Build column bounds between consecutive sharp lines
  // Use middle of each sharp line as boundary
  const halfStrides = top.map((p) => p.i * stride + stride / 2);

  const bounds: TableBounds[] = [];
  // Left boundary = 0 (left edge of canvas)
  bounds.push({ x: 0, width: halfStrides[0] / w });

  for (let i = 0; i < halfStrides.length - 1; i++) {
    bounds.push({ x: halfStrides[i] / w, width: (halfStrides[i + 1] - halfStrides[i]) / w });
  }

  // Right boundary = last line to canvas edge
  bounds.push({ x: halfStrides[halfStrides.length - 1] / w, width: 1 - halfStrides[halfStrides.length - 1] / w });

  return bounds.length >= 5 ? bounds : null;
}

/**
 * Extracts a sub-region canvas for a specific table column,
 * using the detected column bounds.
 */
function cropColumn(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  bounds: TableBounds,
  padLeft: number,
  padRight: number,
) {
  const x = Math.max(0, sourceW * bounds.x + padLeft);
  const width = Math.min(sourceW * bounds.width - padLeft - padRight, sourceW - x);
  if (width <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, sourceH);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, 0, width, sourceH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropRect(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  rect: { x: number; y: number; width: number; height: number },
  padX = 0,
  padY = 0,
  scale = 1,
) {
  const x = Math.max(0, sourceW * rect.x + padX);
  const y = Math.max(0, sourceH * rect.y + padY);
  const width = Math.min(sourceW * rect.width - padX * 2, sourceW - x);
  const height = Math.min(sourceH * rect.height - padY * 2, sourceH - y);
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function scoreRecognizedRows(rows: CwResultRow[]) {
  return rows.reduce((score, row) => {
    const filledStats = [row.kills, row.deaths, row.assists, row.treasury_spent, row.score].filter((value) => Number(value) > 0).length;
    return score + row.character_name.length * 2 + filledStats * 20 + (row.score > 0 ? 30 : 0);
  }, 0);
}

function scoreRowQuality(row: CwResultRow) {
  let score = 0;
  if (row.character_name.trim().length >= 3) score += 15;
  if (row.kills >= 0 && row.kills <= 45) score += 20; else score -= 20;
  if (row.deaths >= 0 && row.deaths <= 30) score += 20; else score -= 20;
  if (row.assists >= 0 && row.assists <= 30) score += 20; else score -= 20;
  if (row.treasury_spent >= 100 && row.treasury_spent <= 100_000) score += 20;
  else if (row.treasury_spent > 0 && row.treasury_spent <= 250_000) score += 8;
  else score -= 12;

  if (row.score >= 100 && row.score <= 10_000) score += 22;
  else if (row.score > 0 && row.score <= 25_000) score += 8;
  else if (row.score === 0 && row.treasury_spent > 0) score -= 18;
  else score -= 10;

  const kd = row.deaths === 0 ? row.kills : row.kills / Math.max(1, row.deaths);
  if (kd <= 8) score += 8; else score -= 10;
  if (row.kills >= 6 && row.deaths === 0) score -= 22;
  if (row.kills >= 6 && row.assists === 0) score -= 12;
  if (row.treasury_spent >= 5000 && row.score < 200) score -= 16;
  if (row.treasury_spent >= 5000 && row.deaths === 0 && row.assists === 0) score -= 20;
  if (row.deaths > 0) score += 6;
  if (row.assists > 0) score += 4;
  if (/[0-9]$/.test(row.character_name.trim())) score -= 8;
  return score;
}

function scoreCandidateQuality(rows: CwResultRow[]) {
  if (!rows.length) return Number.NEGATIVE_INFINITY;
  const rowScores = rows.reduce((sum, row) => sum + scoreRowQuality(row), 0);
  const zeroScores = rows.filter((row) => row.score === 0 && row.treasury_spent > 0).length;
  const hugeTreasury = rows.filter((row) => row.treasury_spent > 120_000).length;
  const flatRows = rows.filter((row) => row.kills > 0 && row.deaths === 0 && row.assists === 0).length;
  const suspiciousInfKd = rows.filter((row) => row.deaths === 0 && row.kills >= 4).length;
  return rowScores + rows.length * 30 - zeroScores * 25 - hugeTreasury * 12 - flatRows * 18 - suspiciousInfKd * 14;
}

function pickBetterRows(currentRows: CwResultRow[], candidateRows: CwResultRow[]) {
  const currentScore = scoreCandidateQuality(currentRows);
  const candidateScore = scoreCandidateQuality(candidateRows);
  return candidateScore > currentScore + 6 ? candidateRows : currentRows;
}

function sanitizeOcrColumnLines(lines: string[], kind: "name" | "number") {
  if (kind === "number") {
    return lines
      .map((line) => normalizeOcrNumberToken(line))
      .filter(Boolean);
  }

  return lines
    .map((line) => line.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/^(?:#|№)?\s*[\dOoОоIlІ|]{1,2}\s+/, ""))
    .filter((line) => line.length > 1 && !OCR_IGNORED_ROW.test(line));
}

function sanitizeOcrRowLines(lines: string[]) {
  return lines
    .map((line) => line.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 4 && !OCR_IGNORED_ROW.test(line));
}

async function recognizePreparedCanvas(
  worker: Tesseract.Worker,
  canvas: HTMLCanvasElement,
  kind: "name" | "number" | "row",
  options?: { singleLine?: boolean; pagesegMode?: string },
) {
  const params: Record<string, string> = {
    preserve_interword_spaces: "1",
    tessedit_char_whitelist: kind === "number"
      ? "0123456789OoОоIlІ|ЗзБб"
      : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789_-.[]# ",
  };

  if (kind === "row") {
    params.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789_-.[]# ";
  }

  if (options?.pagesegMode) {
    params.tessedit_pageseg_mode = options.pagesegMode;
  } else if (options?.singleLine) {
    params.tessedit_pageseg_mode = kind === "number" ? "8" : "7";
  }

  await worker.setParameters(params as any);
  const result = await worker.recognize(canvas);
  return (result.data.text || "").trim();
}

async function recognizePreparedCanvasCandidates(
  worker: Tesseract.Worker,
  canvas: HTMLCanvasElement,
  kind: "name" | "number" | "row",
) {
  const attempts = kind === "number"
    ? [
      { singleLine: true, pagesegMode: "8" },
      { singleLine: true, pagesegMode: "7" },
      { singleLine: true, pagesegMode: "13" },
      {},
    ]
    : kind === "row"
      ? [
        { singleLine: true, pagesegMode: "7" },
        { singleLine: true, pagesegMode: "13" },
        { pagesegMode: "6" },
      ]
      : [
        { singleLine: true, pagesegMode: "7" },
        { singleLine: true, pagesegMode: "13" },
        {},
      ];

  const unique = new Set<string>();
  const values: string[] = [];

  for (const attempt of attempts) {
    const text = await recognizePreparedCanvas(worker, canvas, kind, attempt);
    const nextValues = kind === "number"
      ? sanitizeOcrColumnLines(text.split("\n"), "number")
      : kind === "name"
        ? sanitizeOcrColumnLines(text.split("\n"), "name")
        : sanitizeOcrRowLines(text.split("\n"));
    for (const value of nextValues) {
      if (unique.has(value)) continue;
      unique.add(value);
      values.push(value);
    }
  }

  return values;
}

function buildFixedRowCombinations(columns: string[][], limit = 96) {
  const variants = columns.map((column) => {
    const unique = [...new Set(column.filter(Boolean))];
    if (unique.length === 0) return [""];
    return unique.slice(0, 2);
  });

  let combinations: string[][] = [[]];
  for (const variant of variants) {
    const next: string[][] = [];
    for (const prefix of combinations) {
      for (const value of variant) {
        next.push([...prefix, value]);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    combinations = next;
    if (combinations.length >= limit) break;
  }

  return combinations;
}

function pickBestRowCandidate(candidates: CwResultRow[], knownNames: string[]) {
  let bestRow: CwResultRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const normalized = sanitizeCwRows([candidate], knownNames).rows[0];
    if (!normalized) continue;
    let score = scoreRowQuality(normalized);
    if (knownNames.includes(normalized.character_name)) score += 14;
    if (normalized.matches_count === 1) score += 4;
    if (normalized.score > 0) score += 4;
    if (normalized.treasury_spent > 0) score += 4;
    if (score > bestScore) {
      bestScore = score;
      bestRow = normalized;
    }
  }

  return bestRow;
}

async function ocrStalcraftFixedRows(
  imageSource: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  worker: Tesseract.Worker,
  onStatus: (msg: string) => void,
  knownNames: string[],
): Promise<{ rows: CwResultRow[]; label: string } | null> {
  let bestRows: CwResultRow[] = [];
  let bestLabel = "";
  let bestScore = -1;

  for (const crop of STALCRAFT_FIXED_ROW_CROPS) {
    for (const mode of ["whiteText", "whiteTextSoft", "contrast"] as const) {
      const tableCanvas = buildOcrCanvas(imageSource, imageWidth, imageHeight, crop, mode);
      try {
        for (const layout of STALCRAFT_FIXED_ROW_LAYOUTS) {
          onStatus(`${crop.label} · ${mode} · ${layout.label}: OCR строк...`);
          const rows: CwResultRow[] = [];
          const rowHeight = layout.height / layout.rows;

          for (const columnLayout of STALCRAFT_FIXED_COLUMN_LAYOUTS) {
            const layoutRows: CwResultRow[] = [];

            for (let rowIndex = 0; rowIndex < layout.rows; rowIndex += 1) {
              const rowTop = layout.top + rowIndex * rowHeight;
              const partCandidates: string[][] = [];

              for (const spec of columnLayout.columns) {
                const cellCanvas = cropRect(
                  tableCanvas,
                  tableCanvas.width,
                  tableCanvas.height,
                  { x: spec.x, y: rowTop, width: spec.width, height: rowHeight },
                  spec.kind === "name" ? 8 : 2,
                  2,
                  spec.kind === "name" ? 2.2 : 2.8,
                );
                if (!cellCanvas) {
                  partCandidates.push([""]);
                  continue;
                }

                try {
                  const values = await recognizePreparedCanvasCandidates(worker, cellCanvas, spec.kind);
                  partCandidates.push(values.length ? values : [""]);
                } finally {
                  cellCanvas.remove();
                }
              }

              const rowCandidates: CwResultRow[] = [];
              for (const parts of buildFixedRowCombinations(partCandidates)) {
                const row = parseColumnRow(parts);
                if (row) rowCandidates.push(row);
              }

              const rowCanvas = cropRect(
                tableCanvas,
                tableCanvas.width,
                tableCanvas.height,
                { x: 0.02, y: rowTop, width: 0.89, height: rowHeight },
                2,
                2,
                2.7,
              );
              if (rowCanvas) {
                try {
                  const lineCandidates = await recognizePreparedCanvasCandidates(worker, rowCanvas, "row");
                  for (const line of lineCandidates) {
                    const parsed = parseStalcraftScoreboardLine(line);
                    if (parsed) rowCandidates.push(parsed);
                    const bestName = partCandidates[0]?.[0];
                    if (parsed && bestName) {
                      const hybrid = parseColumnRow([
                        bestName,
                        String(parsed.kills),
                        String(parsed.deaths),
                        String(parsed.assists),
                        String(parsed.treasury_spent),
                        String(parsed.score),
                      ]);
                      if (hybrid) rowCandidates.push(hybrid);
                    }
                  }
                } finally {
                  rowCanvas.remove();
                }
              }

              const bestRow = pickBestRowCandidate(rowCandidates, knownNames);
              if (bestRow) layoutRows.push(bestRow);
            }

            const candidateRows = sanitizeCwRows(layoutRows, knownNames).rows;
            const candidateScore = scoreRecognizedRows(candidateRows);
            if (
              candidateRows.length > rows.length
              || (candidateRows.length === rows.length && candidateScore > scoreRecognizedRows(rows))
            ) {
              rows.splice(0, rows.length, ...candidateRows);
              bestLabel = `${crop.label} · ${mode} · ${layout.label} · ${columnLayout.label} · fixed rows`;
            }
          }

          const normalized = sanitizeCwRows(rows, knownNames).rows;
          const score = scoreRecognizedRows(normalized);
          if (
            normalized.length > bestRows.length
            || (normalized.length === bestRows.length && score > bestScore)
          ) {
            bestRows = normalized;
            bestLabel = `${crop.label} · ${mode} · ${layout.label} · fixed rows`;
            bestScore = score;
          }

          if (normalized.length >= 12 && score >= bestScore) {
            return { rows: normalized, label: `${crop.label} · ${mode} · ${layout.label} · fixed rows` };
          }
        }
      } finally {
        tableCanvas.remove();
      }
    }
  }

  return bestRows.length > 0 ? { rows: bestRows, label: bestLabel } : null;
}

async function ocrStalcraftFixedLayout(
  imageSource: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  worker: Tesseract.Worker,
  onStatus: (msg: string) => void,
  knownNames: string[],
): Promise<{ rows: CwResultRow[]; label: string } | null> {
  let bestRows: CwResultRow[] = [];
  let bestLabel = "";
  let bestScore = -1;

  for (const crop of STALCRAFT_FIXED_ROW_CROPS) {
    for (const mode of ["whiteText", "whiteTextSoft", "contrast"] as const) {
      onStatus(`${crop.label} · ${mode}: OCR колонок...`);
      const rowCanvas = buildOcrCanvas(imageSource, imageWidth, imageHeight, crop, mode);

      try {
        for (const columnLayout of STALCRAFT_FIXED_COLUMN_LAYOUTS) {
          const columns: string[][] = [];
          for (const spec of columnLayout.columns) {
            const pad = spec.kind === "name" ? 6 : 2;
            const colCanvas = cropColumn(rowCanvas, rowCanvas.width, rowCanvas.height, { x: spec.x, width: spec.width }, pad, pad);
            if (!colCanvas) {
              columns.push([]);
              continue;
            }

            try {
              const values = await recognizePreparedCanvasCandidates(worker, colCanvas, spec.kind);
              columns.push(values);
            } finally {
              colCanvas.remove();
            }
          }

          const rowCount = Math.max(...columns.map((column) => column.length), 0);
          if (rowCount < 5) continue;

          const rows: CwResultRow[] = [];
          for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const name = columns[0]?.[rowIndex] || "";
            const parts = [
              name,
              columns[1]?.[rowIndex] || "",
              columns[2]?.[rowIndex] || "",
              columns[3]?.[rowIndex] || "",
              columns[4]?.[rowIndex] || "",
              columns[5]?.[rowIndex] || "",
            ];
            const row = parseColumnRow(parts);
            if (row) rows.push(row);
          }

          const normalized = sanitizeCwRows(rows, knownNames).rows;
          const score = scoreRecognizedRows(normalized);
          if (
            normalized.length > bestRows.length
            || (normalized.length === bestRows.length && score > bestScore)
          ) {
            bestRows = normalized;
            bestLabel = `${crop.label} · ${mode} · ${columnLayout.label} · fixed columns`;
            bestScore = score;
          }
          if (normalized.length >= 12 && score >= bestScore) {
            return { rows: normalized, label: `${crop.label} · ${mode} · ${columnLayout.label} · fixed columns` };
          }
        }
      } finally {
        rowCanvas.remove();
      }
    }
  }

  if (bestRows.length < 12) {
    const rowBased = await ocrStalcraftFixedRows(imageSource, imageWidth, imageHeight, worker, onStatus, knownNames);
    if (rowBased?.rows?.length) {
      const rowScore = scoreRecognizedRows(rowBased.rows);
      if (
        rowBased.rows.length > bestRows.length
        || (rowBased.rows.length === bestRows.length && rowScore > bestScore)
      ) {
        bestRows = rowBased.rows;
        bestLabel = rowBased.label;
        bestScore = rowScore;
      }
    }
  }

  return bestRows.length > 0 ? { rows: bestRows, label: bestLabel } : null;
}

// ─── Column-based result parser (primary when table detected) ────────────────

/**
 * Parses a table row given 5 individual text strings (one per column):
 * name | kills | deaths | assists | treasury | score
 */
function parseColumnRow(parts: string[]): CwResultRow | null {
  if (parts.length < 6) return null;

  const [nameRaw, killsRaw, deathsRaw, assistsRaw, treasuryRaw, scoreRaw] = parts;
  const character_name = nameRaw
    .replace(/[|¦]/g, " ")
    .replace(/[^\p{L}\p{N}\s_[\].#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:#|№)?[\dOoОоIlІ|]{1,3}\s*/, "");

  if (!character_name || character_name.length < 2) return null;

  const normalize = (v: string) =>
    Number.parseInt(
      String(v || "0")
        .replace(/[OoОо]/g, "0")
        .replace(/[IlІ|]/g, "1")
        .replace(/[Зз]/g, "3")
        .replace(/[Бб]/g, "6")
        .replace(/[^\d]/g, ""),
      10,
    ) || 0;

  const kills = normalize(killsRaw);
  const deaths = normalize(deathsRaw);
  const assists = normalize(assistsRaw);
  const treasury = normalize(treasuryRaw);
  const score = normalize(scoreRaw);

  // Score penalties (soft — log warning instead of rejecting)
  let rejected = false;
  if (kills > 1000 || deaths > 1000 || assists > 1000) rejected = true;
  if (treasury > 999_999_999 || score > 999_999_999) rejected = true;

  if (rejected) {
    // Still return but with a flag — let AI correct it if needed
  }

  return {
    character_name,
    matches_count: 1,
    kills,
    deaths,
    assists,
    treasury_spent: treasury,
    score,
  };
}

/**
 * OCR each table column separately, then reconstruct rows.
 * Returns rows from column-based parsing, or null if it fails.
 */
async function ocrTableByColumns(
  imageSource: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  crop: { x: number; y: number; width: number; height: number },
  worker: Tesseract.Worker,
  label: string,
  onStatus: (msg: string) => void,
): Promise<CwResultRow[] | null> {
  const sx = Math.max(0, Math.floor(imageWidth * crop.x));
  const sy = Math.max(0, Math.floor(imageHeight * crop.y));
  const sw = Math.min(imageWidth - sx, Math.floor(imageWidth * crop.width));
  const sh = Math.min(imageHeight - sy, Math.floor(imageHeight * crop.height));

  // Draw cropped region to a temp canvas
  const tableCanvas = document.createElement("canvas");
  tableCanvas.width = sw;
  tableCanvas.height = sh;
  const tctx = tableCanvas.getContext("2d", { willReadFrequently: true });
  if (!tctx) return null;
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(imageSource, sx, sy, sw, sh, 0, 0, tableCanvas.width, tableCanvas.height);

  const colBounds = detectTableColumns(tableCanvas);
  if (!colBounds || colBounds.length < 5) return null;

  onStatus(`${label}: детект колонок (${colBounds.length})...`);

  // OCR each column separately
  const colTexts: string[] = [];
  for (let i = 0; i < colBounds.length; i++) {
    const pad = i === 0 || i === colBounds.length - 1 ? 4 : 2; // smaller pad for inner cols
    const colCanvas = cropColumn(tableCanvas, sw, sh, colBounds[i], pad, pad);
    if (!colCanvas) { colTexts.push(""); continue; }
    const result = await worker.recognize(colCanvas);
    colTexts.push((result.data.text || "").trim());
    colCanvas.remove();
  }

  // Split each column text into lines
  const colLines = colTexts.map((t) => t.split("\n").map((l) => l.trim()).filter((l) => l.length > 0));
  const maxLines = Math.max(...colLines.map((c) => c.length));
  if (maxLines < 2) return null; // need at least 2 rows (header + data)

  const rows: CwResultRow[] = [];
  for (let r = 0; r < maxLines; r++) {
    const parts = colLines.map((c) => c[r] || "");
    const row = parseColumnRow(parts);
    if (row) rows.push(row);
  }

  return rows.length >= 2 ? rows : null;
}

/** Fallback: line-by-line parser used when column detection fails */
function parseOcrResultRowsFallback(value: string): CwResultRow[] {
  return value
    .split("\n")
    .map((line) => line.replace(/[|¦]/g, " ").trim())
    .filter((line) => line.length > 3 && !OCR_IGNORED_ROW.test(line))
    .map((line) => {
      const stalcraftRow = parseStalcraftScoreboardLine(line);
      if (stalcraftRow) return stalcraftRow;

      const numericMatches = [...line.matchAll(/\d+(?:[,.]\d+)?/g)];
      if (numericMatches.length < 6) return null;

      const firstNumberIndex = numericMatches[0]?.index ?? line.length;
      const character_name = line
        .slice(0, firstNumberIndex)
        .replace(/[^\p{L}\p{N}\s_[\].#-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!character_name || character_name.length < 2) return null;

      const parsed = parseOcrNumbers(numericMatches.map((match) => match[0]));
      if (!parsed) return null;

      return {
        character_name,
        ...parsed,
      };
    })
    .filter(Boolean) as CwResultRow[];
}

function aggregateRows(rows: CwResultRow[]) {
  const byName = new Map<string, CwResultRow & { tabs_count: number }>();

  for (const row of rows) {
    const name = row.character_name.trim();
    const key = name.toLocaleLowerCase("ru");
    const current = byName.get(key);
    if (!current) {
      byName.set(key, { ...row, matches_count: Math.max(1, toInt(row.matches_count || 1)), character_name: name, tabs_count: 1 });
      continue;
    }

    current.matches_count += Math.max(1, toInt(row.matches_count || 1));
    current.kills += toInt(row.kills);
    current.deaths += toInt(row.deaths);
    current.assists += toInt(row.assists);
    current.treasury_spent += toInt(row.treasury_spent);
    current.score += toInt(row.score);
    current.tabs_count += 1;
  }

  return [...byName.values()].sort((a, b) => b.score - a.score || b.kills - a.kills);
}

function formatKd(row: CwResultRow) {
  if (row.deaths === 0) return row.kills > 0 ? "∞" : "0.00";
  return (row.kills / row.deaths).toFixed(2);
}

function formatKda(row: CwResultRow) {
  if (row.deaths === 0) return row.kills + row.assists > 0 ? "∞" : "0.00";
  return ((row.kills + row.assists) / row.deaths).toFixed(2);
}

function formatStat(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

function formatMskDateTime(value: string | null | undefined) {
  if (!value) return "нет данных";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(date);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueClanOptions(characters: any[]) {
  const byKey = new Map<string, { key: string; clan_id: string | null; clan_name: string; region: string | null; character_name: string }>();

  for (const character of characters || []) {
    const clanName = String(character.clan_name || "").trim();
    if (!clanName) continue;
    const clanId = character.clan_id ? String(character.clan_id) : null;
    const region = character.region ? String(character.region) : null;
    const key = `${region || "ANY"}:${clanId || clanName}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        clan_id: clanId,
        clan_name: clanName,
        region,
        character_name: character.character_name || "персонаж",
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.clan_name.localeCompare(b.clan_name, "ru"));
}

async function loadImageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    img.src = URL.createObjectURL(file);
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(image.src),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось подготовить скрин для ИИ-проверки."));
    reader.readAsDataURL(file);
  });
}

function buildOcrCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: { x: number; y: number; width: number; height: number },
  mode: OcrCanvasMode,
) {
  const sx = Math.max(0, Math.floor(sourceWidth * crop.x));
  const sy = Math.max(0, Math.floor(sourceHeight * crop.y));
  const sw = Math.min(sourceWidth - sx, Math.floor(sourceWidth * crop.width));
  const sh = Math.min(sourceHeight - sy, Math.floor(sourceHeight * crop.height));
  const scale = Math.min(3, Math.max(1.6, 2600 / Math.max(sw, sh)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas недоступен для OCR.");

  context.imageSmoothingEnabled = false;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const contrasted = Math.max(0, Math.min(255, (gray - 118) * 2.7 + 128));
    let value = 255 - contrasted;

    if (mode === "threshold") {
      value = contrasted > 150 ? 0 : 255;
    } else if (mode === "whiteText") {
      value = gray >= 176 && saturation <= 70 ? 0 : 255;
    } else if (mode === "whiteTextSoft") {
      value = gray >= 158 && saturation <= 92 ? 0 : 255;
    }

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);

  return canvas;
}

function buildCropDataUrl(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: { x: number; y: number; width: number; height: number },
  mode?: OcrCanvasMode,
) {
  const canvas = mode
    ? buildOcrCanvas(source, sourceWidth, sourceHeight, crop, mode)
    : cropRect(source, sourceWidth, sourceHeight, crop, 0, 0, 1.7);
  if (!canvas) return "";
  try {
    return canvas.toDataURL("image/png");
  } finally {
    canvas.remove();
  }
}

export function ScGuildDashboardClient({ guildId, data, activeSection }: Props) {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownRosterNames = useMemo(
    () => [...new Set((data.clanMembers || []).map((member: any) => String(member.character_name || "").trim()).filter(Boolean))],
    [data.clanMembers],
  );
  const [status, setStatus] = useState("");
  const [editorRows, setEditorRows] = useState<CwResultRow[]>([]);
  const [ocrStatus, setOcrStatus] = useState("Картинка не сохраняется: OCR работает в браузере.");
  const [ocrNotes, setOcrNotes] = useState<string[]>([]);
  const [ocrSource, setOcrSource] = useState("—");
  const [ocrPreviewRows, setOcrPreviewRows] = useState<CwResultRow[]>([]);
  const [resultRows, setResultRows] = useState<CwResultRow[]>(() => data.resultQueue || []);
  const [squads, setSquads] = useState<any[]>(() => data.squads || []);
  const [squadMembers, setSquadMembers] = useState<any[]>(() => data.squadMembers || []);
  const [squadForm, setSquadForm] = useState({ name: "", description: "", voice_channel_id: "" });
  const clanOptions = useMemo(() => uniqueClanOptions(data.userCharacters || []), [data.userCharacters]);
  const initialClanKey = clanOptions.find((clan) => clan.clan_id && clan.clan_id === data.settings?.clan_id)?.key || "";
  const [settings, setSettings] = useState({
    community_name: data.settings?.community_name || data.guild?.name || "",
    clan_id: data.settings?.clan_id || data.settings?.required_clan_id || "",
    clan_name: data.settings?.clan_name || data.settings?.required_clan_name || "",
    clan_key: initialClanKey,
    region: data.settings?.region || "",
    cw_post_channel_id: data.settings?.cw_post_channel_id || "",
    absence_channel_id: data.settings?.absence_channel_id || "",
    results_channel_id: data.settings?.results_channel_id || "",
    squads_channel_id: data.settings?.squads_channel_id || "",
    emission_channel_id: data.settings?.emission_channel_id || "",
    logs_channel_id: data.settings?.logs_channel_id || "",
    sc_commands_channel_id: data.settings?.sc_commands_channel_id || "",
    auto_create_roles: data.settings?.auto_create_roles ?? true,
  });
  const [roles, setRoles] = useState(() =>
    roleKeys.map(([role_key, defaultName]) => {
      const current = data.scRoles?.find((role: any) => role.role_key === role_key);
      return {
        role_key,
        role_id: current?.role_id || "",
        role_name: current?.role_name || defaultName,
      };
    }),
  );

  const channelOptions = data.channels || [];
  const roleOptions = data.discordRoles || [];
  const missingSquadTables = (data.schemaWarnings || []).some((warning: string) => warning.includes("sc_cw_squad"));
  const attendanceSummary = useMemo(() => {
    const rows = data.attendance || [];
    return {
      attending: rows.filter((row: any) => row.status === "attending").length,
      absent: rows.filter((row: any) => row.status === "absent").length,
      total: rows.length,
    };
  }, [data.attendance]);
  const parsedRows = useMemo(() => sanitizeCwRows(editorRows, knownRosterNames).rows, [editorRows, knownRosterNames]);
  const totalRows = useMemo(() => aggregateRows(resultRows), [resultRows]);
  const tabsSummary = useMemo(() => {
    const previewScore = ocrPreviewRows.reduce((sum, row) => sum + toInt(row.score), 0);
    const queueScore = totalRows.reduce((sum, row) => sum + toInt(row.score), 0);
    return {
      previewRows: ocrPreviewRows.length,
      parsedRows: parsedRows.length,
      queueRows: totalRows.length,
      queueTabs: resultRows.length,
      previewScore,
      queueScore,
    };
  }, [ocrPreviewRows, parsedRows, resultRows.length, totalRows]);
  const readinessSummary = useMemo(() => {
    const equipmentByUser = new Map<string, Set<string>>();
    for (const item of data.equipment || []) {
      const userId = String(item.discord_user_id || "");
      if (!userId) continue;
      const slots = equipmentByUser.get(userId) || new Set<string>();
      slots.add(String(item.slot || ""));
      equipmentByUser.set(userId, slots);
    }

    const members = data.clanMembers || [];
    const ready = members.filter((member: any) => {
      const slots = equipmentByUser.get(String(member.discord_user_id));
      return slots?.has("weapon") && slots?.has("armor");
    }).length;

    return { ready, total: members.length };
  }, [data.clanMembers, data.equipment]);
  const membersBySquad = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const member of squadMembers) {
      const key = String(member.squad_id);
      grouped.set(key, [...(grouped.get(key) || []), member]);
    }
    return grouped;
  }, [squadMembers]);
  const currentSessionId = data.currentSession?.id ? String(data.currentSession.id) : "";

  useEffect(() => {
    setResultRows(data.resultQueue || []);
  }, [data.resultQueue]);

  useEffect(() => {
    setSquads(data.squads || []);
  }, [data.squads]);

  useEffect(() => {
    setSquadMembers(data.squadMembers || []);
  }, [data.squadMembers]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return undefined;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 250);
    };

    const channel = supabase
      .channel(`sc-dashboard:${guildId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_guilds", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_guild_settings", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_discord_channels", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_discord_roles", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_roles", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_cw_sessions", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_cw_result_queue", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_cw_squads", filter: `guild_id=eq.${guildId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sc_emission_state", filter: `guild_id=eq.${guildId}` }, scheduleRefresh);

    if (currentSessionId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sc_cw_attendance", filter: `session_id=eq.${currentSessionId}` },
        scheduleRefresh,
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [currentSessionId, guildId, router]);

  function selectClan(key: string) {
    const clan = clanOptions.find((item) => item.key === key);
    setSettings((prev) => {
      if (!clan) return { ...prev, clan_key: "", clan_id: "", clan_name: "" };
      return {
        ...prev,
        clan_key: key,
        clan_id: clan.clan_id || "",
        clan_name: clan.clan_name,
        community_name: prev.community_name || clan.clan_name,
        region: prev.region || clan.region || "",
      };
    });
  }

  async function saveSettings() {
    setStatus("Сохраняю...");
    const response = await fetch(`/api/sc/guilds/${guildId}/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...settings,
        clan_key: undefined,
        clan_id: settings.clan_id || null,
        clan_name: settings.clan_name || null,
        community_name: settings.community_name || null,
        region: settings.region || null,
        cw_post_channel_id: settings.cw_post_channel_id || null,
        absence_channel_id: settings.absence_channel_id || null,
        results_channel_id: settings.results_channel_id || null,
        squads_channel_id: settings.squads_channel_id || null,
        emission_channel_id: settings.emission_channel_id || null,
        logs_channel_id: settings.logs_channel_id || null,
        sc_commands_channel_id: settings.sc_commands_channel_id || null,
        roles: roles.map((role) => ({
          ...role,
          role_id: role.role_id || null,
          role_name: role.role_name || null,
        })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setStatus(response.ok ? "Сохранено." : body.error || "Ошибка сохранения.");
  }

  async function uploadRows(rows: CwResultRow[]) {
    if (!rows.length) {
      setStatus("Строки табов не найдены.");
      return;
    }
    setStatus("Загружаю табы...");
    const response = await fetch(`/api/sc/guilds/${guildId}/cw-results`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const body = await response.json().catch(() => ({}));
    setStatus(response.ok ? `Загружено строк: ${body.count || rows.length}.` : body.error || "Ошибка загрузки.");
    if (response.ok) {
      setResultRows((current) => [...current, ...rows]);
      setOcrPreviewRows([]);
      setOcrNotes([]);
      setOcrSource("—");
      setEditorRows([]);
    }
  }

  async function uploadResults() {
    await uploadRows(parsedRows);
  }

  async function clearResults() {
    const confirmed = window.confirm("Очистить все загруженные строки табов КВ для этого сервера?");
    if (!confirmed) return;

    setStatus("Очищаю таблицу...");
    const response = await fetch(`/api/sc/guilds/${guildId}/cw-results`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setResultRows([]);
      setOcrPreviewRows([]);
      setOcrNotes([]);
      setOcrSource("—");
      setEditorRows([]);
      setStatus(`Таблица очищена. Удалено строк: ${body.count || 0}.`);
    } else {
      setStatus(body.error || "Ошибка очистки таблицы.");
    }
  }

  async function forceCwPost() {
    setStatus("Отправляю запрос боту...");
    const response = await fetch(`/api/sc/guilds/${guildId}/cw-post`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(body.error || "Ошибка запуска КВ-поста.");
      return;
    }

    const actionId = body.action?.id;
    if (!actionId) {
      setStatus("Запрос поставлен в очередь, но сайт не получил ID действия.");
      return;
    }

    setStatus("Запрос поставлен в очередь. Проверяю ответ бота...");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await wait(1500);
      const statusResponse = await fetch(`/api/sc/guilds/${guildId}/cw-post?actionId=${encodeURIComponent(actionId)}`);
      const statusBody = await statusResponse.json().catch(() => ({}));
      const action = statusBody.action;
      if (!statusResponse.ok || !action) continue;

      if (action.status === "done") {
        setStatus("КВ-пост отправлен ботом в выбранный Discord-канал.");
        return;
      }

      if (action.status === "failed") {
        setStatus(action.error_message || "Бот не смог отправить КВ-пост.");
        return;
      }

      if (action.status === "processing") {
        setStatus("Бот принял запрос и отправляет КВ-пост...");
      }
    }

    setStatus("Запрос создан, но бот ещё не подтвердил отправку. Проверь, что бот перезапущен и Supabase Realtime включён.");
  }

  async function mutateSquads(payload: Record<string, unknown>) {
    const response = await fetch(`/api/sc/guilds/${guildId}/squads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!response.ok) throw new Error(body.error || text || `Squad request failed (${response.status}).`);
    return body;
  }

  async function createSquad() {
    if (squads.length >= MAX_CW_SQUADS) {
      setStatus(`Лимит отрядов достигнут: максимум ${MAX_CW_SQUADS} на сервер.`);
      return;
    }
    if (!squadForm.name.trim()) {
      setStatus("Название отряда обязательно.");
      return;
    }

    setStatus("Создаю отряд...");
    try {
      const body = await mutateSquads({
        action: "create",
        name: squadForm.name,
        description: squadForm.description || null,
        voice_channel_id: squadForm.voice_channel_id || null,
      });
      setSquads((current) => [...current, body.squad]);
      setSquadForm({ name: "", description: "", voice_channel_id: "" });
      setStatus("Отряд создан.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка создания отряда.");
    }
  }

  async function deleteSquad(squadId: string) {
    setStatus("Удаляю отряд...");
    try {
      await mutateSquads({ action: "delete", squad_id: squadId });
      setSquads((current) => current.filter((squad) => squad.id !== squadId));
      setSquadMembers((current) => current.filter((member) => member.squad_id !== squadId));
      setStatus("Отряд удалён.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка удаления отряда.");
    }
  }

  async function assignSquadMember(squadId: string, discordUserId: string) {
    if (!discordUserId) return;
    const member = (data.clanMembers || []).find((row: any) => row.discord_user_id === discordUserId);
    setStatus("Добавляю игрока в отряд...");
    try {
      await mutateSquads({
        action: "assign",
        squad_id: squadId,
        discord_user_id: discordUserId,
        character_name: member?.character_name || null,
      });
      setSquadMembers((current) => [
        ...current.filter((row) => !(row.squad_id === squadId && row.discord_user_id === discordUserId)),
        { squad_id: squadId, discord_user_id: discordUserId, character_name: member?.character_name || null },
      ]);
      setStatus("Игрок добавлен в отряд.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка добавления игрока.");
    }
  }

  async function removeSquadMember(squadId: string, discordUserId: string) {
    setStatus("Убираю игрока из отряда...");
    try {
      await mutateSquads({ action: "remove", squad_id: squadId, discord_user_id: discordUserId });
      setSquadMembers((current) => current.filter((row) => !(row.squad_id === squadId && row.discord_user_id === discordUserId)));
      setStatus("Игрок убран из отряда.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ошибка удаления игрока.");
    }
  }

  async function readScreenshot(file: File) {
    setOcrStatus("Готовлю скрин: детект колонок, затем OCR...");
    setStatus("OCR...");
    setOcrNotes([]);
    setOcrSource("—");

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng+rus");
      const image = await loadImageSource(file);
      let bestRows: CwResultRow[] = [];
      let bestLabel = "";
      let bestTextLength = 0;
      let aiNotes: string[] = [];
      let tableImageDataUrl = "";
      let processedTableImageDataUrl = "";
      let knownNames: string[] = [];

      try {
        tableImageDataUrl = buildCropDataUrl(
          image.source,
          image.width,
          image.height,
          STALCRAFT_AI_TABLE_CROP,
        );
        processedTableImageDataUrl = buildCropDataUrl(
          image.source,
          image.width,
          image.height,
          STALCRAFT_AI_TABLE_CROP,
          "whiteTextSoft",
        );
        knownNames = [...new Set((data.clanMembers || [])
          .map((member: any) => String(member.character_name || "").trim())
          .filter(Boolean))]
          .slice(0, 120);

        await worker.setParameters({ preserve_interword_spaces: "1" });

        const fixedRows = await ocrStalcraftFixedLayout(
          image.source,
          image.width,
          image.height,
          worker,
          (msg) => setOcrStatus(msg),
          knownNames,
        );
        if (fixedRows?.rows?.length) {
          bestRows = fixedRows.rows;
          bestLabel = fixedRows.label;
          bestTextLength = fixedRows.rows.reduce((sum, row) => sum + row.character_name.length + 20, 0);
        }

        const crops = [
          { label: "таблица справа", x: 0.28, y: 0.04, width: 0.70, height: 0.70 },
          { label: "таблица широко", x: 0.22, y: 0.00, width: 0.78, height: 0.78 },
          { label: "полный скрин", x: 0.00, y: 0.00, width: 1.00, height: 1.00 },
        ];

        for (const crop of crops) {
          // Step 1: Try column-based parsing (primary)
          const colRows = await ocrTableByColumns(
            image.source,
            image.width,
            image.height,
            crop,
            worker,
            crop.label,
            (msg) => setOcrStatus(msg),
          );

          if (colRows && colRows.length > 0) {
            const textLen = colRows.reduce((s, r) => s + r.character_name.length + 20, 0);
            if (colRows.length > bestRows.length || (colRows.length === bestRows.length && textLen > bestTextLength)) {
              bestRows = colRows;
              bestLabel = `${crop.label}:колонки`;
              bestTextLength = textLen;
            }
            if (colRows.length >= 12) break;
          }

          // Step 2: Fall back to line-by-line OCR + parsing
          for (const mode of ["contrast", "threshold"] as const) {
            setOcrStatus(`${crop.label} · ${mode}: OCR...`);
            const canvas = buildOcrCanvas(image.source, image.width, image.height, crop, mode);
            try {
              const result = await worker.recognize(canvas);
              const text = result.data.text || "";
              const rows = parseOcrResultRowsFallback(text);
              if (rows.length > bestRows.length || (rows.length === bestRows.length && text.length > bestTextLength)) {
                bestRows = rows;
                bestLabel = `${crop.label} · ${mode}`;
                bestTextLength = text.length;
              }
              if (rows.length >= 12) break;
            } finally {
              canvas.remove();
            }
          }
          if (bestRows.length >= 12) break;
        }
      } finally {
        image.close?.();
        await worker.terminate();
      }

      try {
        setOcrStatus("ИИ проверяет скрин и исправляет строки таба...");
        const response = await fetch(`/api/sc/guilds/${guildId}/cw-results/ai`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: await fileToDataUrl(file),
            tableImageDataUrl,
            processedTableImageDataUrl,
            ocrRows: bestRows,
            knownNames,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok && Array.isArray(body.rows) && body.rows.length > 0) {
          const aiRows = sanitizeCwRows(body.rows, knownRosterNames).rows;
          const chosenRows = pickBetterRows(bestRows, aiRows);
          if (chosenRows !== bestRows) {
            bestRows = chosenRows;
            bestLabel = "AI verification";
          } else {
            aiNotes = ["AI-версия была слабее локального OCR, поэтому оставлен лучший локальный результат."];
          }
          const modelNotes = Array.isArray(body.notes)
            ? body.notes.filter((note: unknown) => typeof note === "string" && note.trim()).map((note: string) => note.trim())
            : [];
          aiNotes = [...aiNotes, ...modelNotes];
        } else if (response.status !== 501) {
          setOcrStatus(body.error || "ИИ не смог улучшить распознавание, оставляю OCR-результат.");
        }
      } catch {
        setOcrStatus("ИИ-проверка недоступна, оставляю OCR-результат.");
      }

      const normalized = sanitizeCwRows(bestRows, knownRosterNames);
      const finalRows = normalized.rows.length > 0 ? normalized.rows : bestRows;
      const finalNotes = normalized.rows.length > 0
        ? [...normalized.notes, ...aiNotes]
        : ["Санитизация отсеяла все строки, поэтому показан сырой OCR-результат. Проверь таблицу вручную.", ...aiNotes];

      setOcrPreviewRows(finalRows);
      setOcrNotes(finalNotes);
      setOcrSource(bestLabel || "не определён");
      setEditorRows(finalRows);
      setOcrStatus(
        finalRows.length
          ? `Распознано строк: ${finalRows.length}. Лучший вариант: ${bestLabel}. Проверь строки ниже и нажми "Загрузить табы".`
          : `OCR не нашёл строки статистики. Лучший вариант: ${bestLabel || "нет"} (${bestTextLength} символов). Попробуй скрин без затемнения/движения или вставь строки вручную.`,
      );
      setStatus(finalRows.length ? "OCR готов." : "OCR без строк.");
    } catch (error) {
      setOcrStatus(error instanceof Error ? error.message : "OCR failed.");
      setStatus("OCR ошибка.");
    }
  }

  function patchManualRow(index: number, patch: Partial<CwResultRow>) {
    const nextRows = editorRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return {
        ...row,
        ...patch,
        character_name: String((patch.character_name ?? row.character_name) || "").trim(),
        matches_count: Math.max(1, toInt(patch.matches_count ?? row.matches_count)),
        kills: Math.max(0, toInt(patch.kills ?? row.kills)),
        deaths: Math.max(0, toInt(patch.deaths ?? row.deaths)),
        assists: Math.max(0, toInt(patch.assists ?? row.assists)),
        treasury_spent: Math.max(0, toInt(patch.treasury_spent ?? row.treasury_spent)),
        score: Math.max(0, toInt(patch.score ?? row.score)),
      };
    });
    setEditorRows(nextRows);
  }

  function removeManualRow(index: number) {
    const nextRows = editorRows.filter((_, rowIndex) => rowIndex !== index);
    setEditorRows(nextRows);
  }

  function addManualRow() {
    setEditorRows([
      ...editorRows,
      {
        character_name: "",
        matches_count: 1,
        kills: 0,
        deaths: 0,
        assists: 0,
        treasury_spent: 0,
        score: 0,
      },
    ]);
  }

  return (
    <div className="dashboard-grid sc-dashboard-grid">
      <aside className="dashboard-sidebar panel sc-dashboard-sidebar">
        <span className="eyebrow sc-eyebrow">STALCRAFT</span>
        <div className="sidebar-links">
          {navItems.map(([key, label, slug]) => (
            <a className={activeSection === key ? "sidebar-link-active" : ""} href={slug ? `/dashboard/${guildId}/${slug}` : `/dashboard/${guildId}`} key={key}>
              {label}
            </a>
          ))}
        </div>
        <div className="panel-note">
          <strong>КВ:</strong> пост в 14:00 МСК, старт в 20:00 МСК.
        </div>
      </aside>

      <div className="dashboard-sections">
        {activeSection === "overview" ? (
          <section className="dashboard-section panel sc-dashboard-section">
            <div className="dashboard-head">
              <div>
                <span className="eyebrow sc-eyebrow">Operations Overview</span>
                <h2>Штабной обзор</h2>
                <p className="muted">Короткая сводка по текущему состоянию STALCRAFT-сервера.</p>
              </div>
              <span className={`badge ${data.guild?.is_available === false ? "warn" : "success"}`}>{data.guild?.is_available === false ? "bot offline" : "bot online"}</span>
            </div>
            <div className="sc-overview-grid">
              <article className="sc-overview-card">
                <span>КВ сегодня</span>
                <strong>{attendanceSummary.attending}/{attendanceSummary.total || 0}</strong>
                <p>участвуют · отсутствуют {attendanceSummary.absent}</p>
              </article>
              <article className="sc-overview-card">
                <span>Отряды</span>
                <strong>{squads.length}</strong>
                <p>создано для текущего штаба</p>
              </article>
              <article className="sc-overview-card">
                <span>Табы</span>
                <strong>{totalRows.length}</strong>
                <p>игроков в общей таблице</p>
              </article>
              <article className="sc-overview-card">
                <span>Снаряжение</span>
                <strong>{readinessSummary.ready}/{readinessSummary.total}</strong>
                <p>игроков с оружием и бронёй</p>
              </article>
              <article className="sc-overview-card">
                <span>Выброс</span>
                <strong>{data.emission?.state === "active" ? "active" : "idle"}</strong>
                <p>{data.emission?.raw?.region || settings.region || "регион не задан"} · {formatMskDateTime(data.emission?.last_seen_at || data.emission?.updated_at)}</p>
                <p>старт {formatMskDateTime(data.emission?.last_started_at || data.emission?.started_at)} · конец {formatMskDateTime(data.emission?.last_ended_at || data.emission?.ended_at)}</p>
              </article>
              <article className="sc-overview-card">
                <span>Клан</span>
                <strong>{settings.clan_name || data.settings?.clan_name || "не выбран"}</strong>
                <p>{settings.region || "регион не задан"}</p>
              </article>
            </div>
            <div className="sc-overview-actions">
              <a className="primary-button sc-primary" href={`/dashboard/${guildId}/attendance`}>Посещения</a>
              <a className="secondary-button sc-secondary" href={`/dashboard/${guildId}/squads`}>Отряды КВ</a>
              <a className="ghost-button sc-ghost" href={`/dashboard/${guildId}/cw-tabs`}>Табы</a>
              <button className="secondary-button sc-secondary" onClick={forceCwPost} type="button">Запустить КВ-пост сейчас</button>
              {settings.clan_id ? <a className="ghost-button sc-ghost" href={`/clans/${settings.clan_id}`}>Клановая таблица</a> : null}
              <a className="ghost-button sc-ghost" href={`/dashboard/${guildId}/settings`}>Настройки</a>
            </div>
          </section>
        ) : null}

        {activeSection === "settings" ? (
          <section className="dashboard-section panel sc-dashboard-section">
            <div className="dashboard-head">
              <div>
                <span className="eyebrow sc-eyebrow">Clan Operations</span>
                <h2>Настройки STALCRAFT клана</h2>
              </div>
              <span className="badge muted">{status || "Editing locally"}</span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Название комьюнити</label>
                <input value={settings.community_name} onChange={(event) => setSettings({ ...settings, community_name: event.target.value })} />
              </div>
              <div className="field">
                <label>Клан из твоих персонажей</label>
                <select value={settings.clan_key} onChange={(event) => selectClan(event.target.value)}>
                  <option value="">Не выбран</option>
                  {clanOptions.map((clan) => (
                    <option key={clan.key} value={clan.key}>
                      [{clan.region || "SC"}] {clan.clan_name} · {clan.character_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Clan name</label>
                <input readOnly value={settings.clan_name} placeholder="Выбери клан выше" />
              </div>
              <div className="field">
                <label>Регион</label>
                <select value={settings.region} onChange={(event) => setSettings({ ...settings, region: event.target.value })}>
                  <option value="">Не задавать</option>
                  <option value="RU">RU</option>
                  <option value="EU">EU</option>
                  <option value="NA">NA</option>
                  <option value="SEA">SEA</option>
                </select>
              </div>
            </div>

            {clanOptions.length === 0 ? (
              <div className="panel-note sc-panel-warning">
                Сайт пока не видит кланы на твоих персонажах. Открой страницу STALCRAFT, нажми &ldquo;Обновить персонажей&rdquo; и выбери персонажа.
              </div>
            ) : null}

            <div className="panel-note">
              Авто-выбросы работают через официальный endpoint <code>https://eapi.stalcraft.net/{"{REGION}"}/emission</code>.
              Для уведомлений выбери регион сервера и канал &ldquo;Выбросы&rdquo;.
            </div>

            <div className="section sc-inner-section">
              <h3>Каналы Discord</h3>
              <div className="form-grid">
                {[
                  ["cw_post_channel_id", "КВ-пост"],
                  ["absence_channel_id", "Отсутствия"],
                  ["results_channel_id", "Итоги"],
                  ["squads_channel_id", "Таблица отрядов"],
                  ["emission_channel_id", "Выбросы"],
                  ["logs_channel_id", "Логи Discord"],
                  ["sc_commands_channel_id", "sc-x-команды"],
                ].map(([key, label]) => (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <select value={(settings as any)[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.value } as any)}>
                      <option value="">Не выбран</option>
                      {channelOptions.map((channel: any) => (
                        <option key={`${key}-${channel.channel_id}`} value={channel.channel_id}>
                          # {channel.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="section sc-inner-section">
              <h3>Роли</h3>
              <div className="form-grid">
                {roles.map((role, index) => (
                  <div className="field" key={role.role_key}>
                    <label>{role.role_name}</label>
                    <select
                      value={role.role_id}
                      onChange={(event) =>
                        setRoles((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, role_id: event.target.value } : item))
                      }
                    >
                      <option value="">Авто / не выбрана</option>
                      {roleOptions.map((discordRole: any) => (
                        <option key={`${role.role_key}-${discordRole.role_id}`} value={discordRole.role_id}>
                          {discordRole.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <button className="primary-button sc-primary" onClick={saveSettings} type="button">Сохранить настройки</button>
          </section>
        ) : null}

        {activeSection === "attendance" ? (
          <section className="dashboard-section panel sc-dashboard-section">
            <div className="dashboard-head">
              <div>
                <span className="eyebrow sc-eyebrow">CW Attendance</span>
                <h2>Посещения и отсутствия</h2>
              </div>
              <span className="badge success">Участвуют {attendanceSummary.attending} / Отсутствуют {attendanceSummary.absent}</span>
            </div>
            <div className="sc-overview-actions" style={{ marginBottom: 16 }}>
              <button className="primary-button sc-primary" onClick={forceCwPost} type="button">Запустить КВ-пост сейчас</button>
            </div>
            <div className="activity-feed-grid">
              {(data.attendance || []).map((row: any) => (
                <article className="activity-card" key={row.id}>
                  <div className="activity-card-head">
                    <span className={`badge ${row.status === "attending" ? "success" : "warn"}`}>{row.status}</span>
                    <span className="activity-time">{row.responded_at || "—"}</span>
                  </div>
                  <strong>{row.character_name || row.discord_user_id}</strong>
                  <p>{row.absence_type ? `${row.absence_type}: ${row.absence_reason || "без причины"}` : "Готов к КВ"}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activeSection === "tabs" ? (
          <section className="dashboard-section panel sc-dashboard-section">
            <div className="dashboard-head">
              <div>
                <span className="eyebrow sc-eyebrow">CW Tabs</span>
                <h2>Скрины КВ и общая таблица</h2>
              </div>
              <span className="badge muted">{tabsSummary.queueRows} player(s)</span>
            </div>

            <div className="panel-note">
              Загрузи скрин таба КВ. Сайт распознает таблицу в браузере, покажет строки для проверки и сохранит в Supabase
              только числовую статистику. Сам скрин не сохраняется.
            </div>

            <div className="sc-tabs-metrics">
              <article className="sc-tabs-metric-card">
                <span>OCR предпросмотр</span>
                <strong>{tabsSummary.previewRows}</strong>
                <p>{ocrSource === "—" ? "источник ещё не выбран" : `лучший проход: ${ocrSource}`}</p>
              </article>
              <article className="sc-tabs-metric-card">
                <span>Редактор строк</span>
                <strong>{tabsSummary.parsedRows}</strong>
                <p>строк готово к загрузке · счёт {formatStat(parsedRows.reduce((sum, row) => sum + row.score, 0))}</p>
              </article>
              <article className="sc-tabs-metric-card">
                <span>Очередь КВ</span>
                <strong>{tabsSummary.queueRows}</strong>
                <p>{tabsSummary.queueTabs} сырьевых строк · общий счёт {formatStat(tabsSummary.queueScore)}</p>
              </article>
            </div>

            <div className="sc-tabs-workbench">
              <div className="sc-upload-zone sc-tabs-upload-card">
                <div>
                  <strong>Загрузить скрин</strong>
                  <span>{ocrStatus}</span>
                </div>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void readScreenshot(file);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </div>

              <div className="sc-table-card sc-tabs-editor-card">
                <div className="dashboard-head">
                  <div>
                    <span className="eyebrow sc-eyebrow">Table editor</span>
                    <h3>Готовая таблица для проверки и правки</h3>
                  </div>
                  <span className="badge muted">{editorRows.length} row(s)</span>
                </div>

                <p className="muted">
                  OCR сразу переносит строки в редактор ниже. Здесь можно поправить ники и числа без лишнего промежуточного буфера.
                </p>

                <div className="sc-manual-editor">
                  <div className="dashboard-head sc-manual-editor-head">
                    <div>
                      <span className="eyebrow sc-eyebrow">Rows</span>
                      <h3>Быстрая правка готовой таблицы</h3>
                    </div>
                    <button className="ghost-button" onClick={addManualRow} type="button">Добавить строку</button>
                  </div>

                  {editorRows.length > 0 ? (
                    <div className="sc-manual-editor-wrap">
                      <table className="sc-manual-editor-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Игрок</th>
                            <th>Матчей</th>
                            <th>У</th>
                            <th>С</th>
                            <th>П</th>
                            <th>Казна</th>
                            <th>Счёт</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {editorRows.map((row, index) => (
                            <tr key={`manual-row-${index}`}>
                              <td>{index + 1}</td>
                              <td>
                                <input
                                  className="sc-manual-input sc-manual-name"
                                  onChange={(event) => patchManualRow(index, { character_name: event.target.value })}
                                  placeholder="Ник игрока"
                                  type="text"
                                  value={row.character_name}
                                />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={1} onChange={(event) => patchManualRow(index, { matches_count: Number(event.target.value || 1) })} type="number" value={row.matches_count} />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={0} onChange={(event) => patchManualRow(index, { kills: Number(event.target.value || 0) })} type="number" value={row.kills} />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={0} onChange={(event) => patchManualRow(index, { deaths: Number(event.target.value || 0) })} type="number" value={row.deaths} />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={0} onChange={(event) => patchManualRow(index, { assists: Number(event.target.value || 0) })} type="number" value={row.assists} />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={0} onChange={(event) => patchManualRow(index, { treasury_spent: Number(event.target.value || 0) })} type="number" value={row.treasury_spent} />
                              </td>
                              <td>
                                <input className="sc-manual-input" min={0} onChange={(event) => patchManualRow(index, { score: Number(event.target.value || 0) })} type="number" value={row.score} />
                              </td>
                              <td>
                                <button className="ghost-button sc-danger-button" onClick={() => removeManualRow(index)} type="button">Убрать</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="panel-note" style={{ marginTop: 12 }}>
                      Здесь появятся строки из OCR. Можно сразу добавить свою строку и собрать таблицу вручную.
                    </div>
                  )}
                </div>

                {ocrNotes.length > 0 ? (
                  <div className="sc-tabs-notes">
                    {ocrNotes.map((note) => (
                      <div className="panel-note" key={note}>{note}</div>
                    ))}
                  </div>
                ) : null}

                <div className="sc-overview-actions">
                  <button className="primary-button sc-primary" disabled={parsedRows.length === 0} onClick={uploadResults} type="button">Загрузить табы</button>
                  <button className="ghost-button sc-danger-button" disabled={resultRows.length === 0 && editorRows.length === 0 && ocrPreviewRows.length === 0} onClick={clearResults} type="button">Очистить таблицу</button>
                </div>
              </div>
            </div>

            <div className="sc-table-card" style={{ marginTop: 24 }}>
              <div className="dashboard-head">
                <div>
                  <span className="eyebrow sc-eyebrow">OCR Preview</span>
                  <h3>Предпросмотр OCR</h3>
                </div>
                <span className="badge muted">{ocrPreviewRows.length} row(s)</span>
              </div>
              <CwTableImproved
                rows={ocrPreviewRows as TableRow[]}
                emptyMessage="Загрузи скрин, и здесь появится таблица распознанных строк."
                showPublishHint={ocrPreviewRows.length > 0 ? `OCR-источник: ${ocrSource}. Проверь строки перед загрузкой.` : undefined}
              />
            </div>

            <div className="sc-table-card" style={{ marginTop: 24 }}>
              <div className="dashboard-head">
                <div>
                  <span className="eyebrow sc-eyebrow">Total table</span>
                  <h3>Общая таблица КВ</h3>
                </div>
              </div>
              <CwTableImproved
                rows={totalRows as TableRow[]}
                emptyMessage="Табы пока не загружены. Загрузи скрин или вставь строки вручную."
                showPublishHint="Публикация итогов в Discord пока идёт через команду `/sc-cw publish-results` у бота."
              />
            </div>
          </section>
        ) : null}

        {activeSection === "squads" ? (
          <section className="dashboard-section panel sc-dashboard-section">
            <div className="dashboard-head">
              <div>
                <span className="eyebrow sc-eyebrow">CW Squads</span>
                <h2>Отряды для КВ</h2>
                <p className="muted">Лидер, полковник или офицер может создать отряды и раскидать игроков клана перед КВ.</p>
              </div>
              <span className="badge muted">{status || `${squads.length} squad(s)`}</span>
            </div>

            {missingSquadTables ? (
              <div className="panel-note sc-panel-warning">
                В Supabase не найдены таблицы отрядов. Выполни SQL <code>supabase/sql/20260502_fix_missing_cw_squads.sql</code>,
                затем обнови страницу.
              </div>
            ) : null}

            <div className="section sc-inner-section">
              <h3>Создать отряд</h3>
              <p className="muted">Лимит: {squads.length}/{MAX_CW_SQUADS} отрядов на сервер.</p>
              <div className="form-grid">
                <div className="field">
                  <label>Название</label>
                  <input value={squadForm.name} onChange={(event) => setSquadForm({ ...squadForm, name: event.target.value })} placeholder="Альфа / Барс / Разведка" />
                </div>
                <div className="field">
                  <label>Голосовой канал</label>
                  <select value={squadForm.voice_channel_id} onChange={(event) => setSquadForm({ ...squadForm, voice_channel_id: event.target.value })}>
                    <option value="">Не привязывать</option>
                    {channelOptions.map((channel: any) => (
                      <option key={`voice-${channel.channel_id}`} value={channel.channel_id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Описание</label>
                  <input value={squadForm.description} onChange={(event) => setSquadForm({ ...squadForm, description: event.target.value })} placeholder="Задача отряда, состав, роль на КВ" />
                </div>
              </div>
              <button className="primary-button sc-primary" disabled={missingSquadTables || squads.length >= MAX_CW_SQUADS} onClick={createSquad} type="button">Создать отряд</button>
            </div>

            <div className="sc-squad-grid">
              {squads.length > 0 ? squads.map((squad) => {
                const assigned = membersBySquad.get(squad.id) || [];
                return (
                  <article className="sc-squad-card" key={squad.id}>
                    <div className="dashboard-head">
                      <div>
                        <span className="eyebrow sc-eyebrow">Squad</span>
                        <h3>{squad.name}</h3>
                        <p className="muted">{squad.description || "Описание не задано"}</p>
                      </div>
                      <button className="ghost-button sc-danger-button" onClick={() => deleteSquad(squad.id)} type="button">Удалить</button>
                    </div>

                    <div className="field">
                      <label>Добавить игрока клана</label>
                      <input
                        list={`squad-member-list-${squad.id}`}
                        placeholder="Поиск по нику..."
                        onChange={(event) => {
                          const match = (data.clanMembers || []).find((m: any) =>
                            (m.character_name || m.discord_user_id).toLowerCase().includes(event.target.value.toLowerCase())
                          );
                          if (match) {
                            assignSquadMember(squad.id, match.discord_user_id);
                            event.target.value = "";
                          }
                        }}
                        type="search"
                      />
                      <datalist id={`squad-member-list-${squad.id}`}>
                        {(data.clanMembers || []).map((member: any) => (
                          <option key={`${squad.id}-dl-${member.discord_user_id}`} value={member.character_name || member.discord_user_id}>
                            {member.character_name || member.discord_user_id}{member.rank ? ` · ${member.rank}` : ""}
                          </option>
                        ))}
                      </datalist>
                    </div>

                    <div className="sc-squad-member-list">
                      {assigned.length > 0 ? assigned.map((member) => (
                        <div className="sc-squad-member" key={`${squad.id}-${member.discord_user_id}`}>
                          <span>
                            <strong>{member.character_name || member.discord_user_id}</strong>
                            <small>{member.discord_user_id}</small>
                          </span>
                          <button className="ghost-button" onClick={() => removeSquadMember(squad.id, member.discord_user_id)} type="button">Убрать</button>
                        </div>
                      )) : <p className="panel-note">В отряде пока нет игроков.</p>}
                    </div>
                  </article>
                );
              }) : (
                <article className="panel-note">Отряды ещё не созданы. Создай первый отряд и добавь игроков из состава клана.</article>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   CW Improved Table — shared between guild dashboard & clan page
   ════════════════════════════════════════════════════ */

type SortKey = "name" | "matches" | "kills" | "deaths" | "assists" | "treasury" | "score" | "kd" | "kda";

type SortState = { key: SortKey; dir: "asc" | "desc" };

type TableRow = {
  character_name: string;
  matches_count: number;
  tabs_count?: number;
  kills: number;
  deaths: number;
  assists: number;
  treasury_spent: number;
  score: number;
};

const PAGE_SIZE = 20;

function calcKd(row: TableRow): number {
  if (row.deaths === 0) return row.kills > 0 ? 99 : 0;
  return row.kills / row.deaths;
}

function calcKda(row: TableRow): number {
  if (row.deaths === 0) return row.kills + row.assists > 0 ? 99 : 0;
  return (row.kills + row.assists) / row.deaths;
}

function kdClass(value: number): string {
  if (value >= 1.5) return "kd-good";
  if (value < 0.8) return "kd-bad";
  return "kd-neutral";
}

function kdaClass(value: number): string {
  if (value >= 3.0) return "kda-good";
  if (value < 1.5) return "kda-bad";
  return "kda-neutral";
}

function sortIndicator(key: SortKey, state: SortState): string {
  if (state.key !== key) return "▼";
  return state.dir === "asc" ? "▲" : "▼";
}

function applySort(rows: TableRow[], state: SortState): TableRow[] {
  return [...rows].sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;

    switch (state.key) {
      case "name":      av = a.character_name.toLowerCase(); bv = b.character_name.toLowerCase(); break;
      case "matches":   av = a.matches_count; bv = b.matches_count; break;
      case "kills":     av = a.kills; bv = b.kills; break;
      case "deaths":    av = a.deaths; bv = b.deaths; break;
      case "assists":   av = a.assists; bv = b.assists; break;
      case "treasury":  av = a.treasury_spent; bv = b.treasury_spent; break;
      case "score":     av = a.score; bv = b.score; break;
      case "kd":        av = calcKd(a); bv = calcKd(b); break;
      case "kda":       av = calcKda(a); bv = calcKda(b); break;
    }

    if (av < bv) return state.dir === "asc" ? -1 : 1;
    if (av > bv) return state.dir === "asc" ? 1 : -1;
    return 0;
  });
}

function toCsv(rows: TableRow[]): string {
  const header = "Игрок,Матчей,Убийства,Смерти,Помощь,Казна,Счёт,K/D,KDA";
  const body = rows.map(r =>
    `${r.character_name},${r.matches_count},${r.kills},${r.deaths},${r.assists},${r.treasury_spent},${r.score},${calcKd(r).toFixed(2)},${calcKda(r).toFixed(2)}`
  );
  return [header, ...body].join("\n");
}

type CwTableImprovedProps = {
  rows: TableRow[];
  emptyMessage?: string;
  showPublishHint?: string;
};

export function CwTableImproved({ rows, emptyMessage = "Табы пока не загружены.", showPublishHint }: CwTableImprovedProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "score", dir: "desc" });
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.character_name.toLowerCase().includes(q));
  }, [rows, deferredSearch]);

  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "desc" }
    );
    setPage(1);
  };

  const th = (label: string, key: SortKey, extra?: string) => {
    const isActive = sort.key === key;
    return (
      <th
        key={key}
        className={`sortable${isActive ? ` sort-${sort.dir}` : ""}${extra ? ` ${extra}` : ""}`}
        onClick={() => handleSort(key)}
      >
        {label}
        <span className="sort-indicator">{sortIndicator(key, sort)}</span>
      </th>
    );
  };

  const handleExport = () => {
    const csv = toCsv(sorted);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cw-results-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    const csv = toCsv(sorted);
    void navigator.clipboard.writeText(csv);
  };

  // Top values for highlight
  const topKills = Math.max(...rows.map(r => r.kills), 0);
  const topScore = Math.max(...rows.map(r => r.score), 0);
  const topKdVal = Math.max(...rows.map(r => calcKd(r)), 0);
  const topKdaVal = Math.max(...rows.map(r => calcKda(r)), 0);
  const totalScore = rows.reduce((sum, row) => sum + row.score, 0);
  const totalTreasury = rows.reduce((sum, row) => sum + row.treasury_spent, 0);
  const avgKd = rows.length > 0 ? rows.reduce((sum, row) => sum + calcKd(row), 0) / rows.length : 0;

  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

  if (rows.length === 0) {
    return (
      <div className="cw-empty-state">
        <strong>Нет данных</strong>
        <p>{emptyMessage}</p>
        {showPublishHint ? <p style={{ marginTop: 8, color: "var(--text-soft)" }}>{showPublishHint}</p> : null}
      </div>
    );
  }

  return (
    <div>
      {showPublishHint ? (
        <div className="panel-note" style={{ marginBottom: 14 }}>
          {showPublishHint}
        </div>
      ) : null}

      <div className="cw-table-toolbar">
        <input
          className="cw-table-search"
          placeholder="Поиск по нику..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <button className="cw-export-btn" onClick={handleCopy} title="Копировать как CSV">
          Копировать CSV
        </button>
        <button className="cw-export-btn" onClick={handleExport} title="Скачать CSV">
          Скачать CSV
        </button>
      </div>

      <div className="cw-table-snapshot">
        <div className="cw-table-snapshot-card">
          <span>Игроков</span>
          <strong>{fmt(rows.length)}</strong>
        </div>
        <div className="cw-table-snapshot-card">
          <span>Общий счёт</span>
          <strong>{fmt(totalScore)}</strong>
        </div>
        <div className="cw-table-snapshot-card">
          <span>Казна</span>
          <strong>{fmt(totalTreasury)}</strong>
        </div>
        <div className="cw-table-snapshot-card">
          <span>Средний K/D</span>
          <strong>{avgKd === 99 ? "∞" : avgKd.toFixed(2)}</strong>
        </div>
      </div>

      <div className="cw-table-wrap">
        <table className="cw-result-table">
          <thead>
            <tr>
              <th>#</th>
              {th("Игрок", "name")}
              {th("Матчей", "matches")}
              {th("Убийства", "kills")}
              {th("Смерти", "deaths")}
              {th("Помощь", "assists")}
              {th("Казна", "treasury")}
              {th("Счёт", "score")}
              {th("K/D", "kd")}
              {th("KDA", "kda")}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const idx = (currentPage - 1) * PAGE_SIZE + i + 1;
              const kdVal = calcKd(row);
              const kdaVal = calcKda(row);
              const multiMatch = (row.matches_count > 1 || (row.tabs_count || 0) > 1);

              const isTopKiller = row.kills === topKills && topKills > 0;
              const isTopScore = row.score === topScore && topScore > 0;
              const isTopKd = kdVal === topKdVal && topKdVal > 0;
              const isTopKda = kdaVal === topKdaVal && topKdaVal > 0;

              const cell = (val: number | string, cls: string, isTop: boolean) => (
                <td className={isTop ? "top-cell-value" : ""}>
                  <span className={cls}>{val}</span>
                </td>
              );

              return (
                <tr
                  key={row.character_name + i}
                  className={[
                    isTopKiller ? "top-killer" : "",
                    isTopScore ? "top-score" : "",
                    isTopKd ? "top-kd" : "",
                    isTopKda ? "top-kda" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <td>
                    {idx}
                    {multiMatch && (
                      <span className="multi-badge" style={{ marginLeft: 5, verticalAlign: "middle" }}>
                        {row.tabs_count ? `${row.tabs_count} таб.` : `${row.matches_count} мат.`}
                      </span>
                    )}
                  </td>
                  <td><strong>{row.character_name}</strong></td>
                  <td>{fmt(row.matches_count)}</td>
                  <td className={isTopKiller ? "top-cell-value" : ""}>{fmt(row.kills)}</td>
                  <td>{fmt(row.deaths)}</td>
                  <td>{fmt(row.assists)}</td>
                  <td>{fmt(row.treasury_spent)}</td>
                  <td className={isTopScore ? "top-cell-value" : ""}>{fmt(row.score)}</td>
                  {cell(kdVal === 99 ? "∞" : kdVal.toFixed(2), kdClass(kdVal), isTopKd)}
                  {cell(kdaVal === 99 ? "∞" : kdaVal.toFixed(2), kdaClass(kdaVal), isTopKda)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="cw-pagination">
          <button
            className="cw-page-btn"
            disabled={currentPage <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ← Назад
          </button>
          <span className="cw-page-info">
            {currentPage} / {totalPages}
          </span>
          <button
            className="cw-page-btn"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Вперёд →
          </button>
        </div>
      )}

      <p style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--text-soft)" }}>
        Показано {sorted.length} из {rows.length} игроков
        {sorted.length !== rows.length ? ` (фильтр: &ldquo;${search}&rdquo;)` : ""}
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   END CW Improved Table
   ════════════════════════════════════════════════════ */

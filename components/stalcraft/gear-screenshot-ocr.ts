import type { StalcraftCharacterCacheRow } from "@/lib/stalcraft/types";
import {
  type GearScreenshotAnalysis,
  type GearScreenshotSearchResult,
  type OcrTextResult,
  matchItem,
  matchNickname,
} from "@/lib/stalcraft/gear-ocr-core";
export type { GearScreenshotAnalysis, GearScreenshotSearchResult } from "@/lib/stalcraft/gear-ocr-core";

type OcrVariant = {
  key: string;
  mode: "nick" | "item" | "full";
  image: HTMLCanvasElement;
  priority?: number;
  slotHint?: "weapon" | "armor" | null;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function applyThreshold(ctx: CanvasRenderingContext2D, width: number, height: number, threshold = 150) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = (data[i] + data[i + 1] + data[i + 2]) / 3 >= threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyLightTextMask(ctx: CanvasRenderingContext2D, width: number, height: number, threshold = 178) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const value = (r + g + b) / 3 >= threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyRedTextMask(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const isRedTitle =
      r >= 100 &&
      r >= g * 1.16 &&
      r >= b * 1.08 &&
      (r - g >= 14 || r - b >= 14);

    const value = isRedTitle ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
}

async function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось открыть изображение."));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function buildVariants(file: File, slotHint: "weapon" | "armor" | null): Promise<OcrVariant[]> {
  const image = await loadImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("У изображения нет корректного размера.");

  const crops = [
    {
      key: "nick-tight",
      mode: "nick" as const,
      box: { x: 0.50, y: 0.09, w: 0.19, h: 0.07 },
      passes: ["soft", "white"] as const,
      priority: 220,
    },
    {
      key: "nick-wide",
      mode: "nick" as const,
      box: { x: 0.48, y: 0.08, w: 0.27, h: 0.12 },
      passes: ["soft", "white"] as const,
      priority: 180,
    },
    {
      key: "weapon-title-tight",
      mode: "item" as const,
      box: { x: 0.68, y: 0.16, w: 0.18, h: 0.07 },
      passes: ["soft", "red"] as const,
      priority: 360,
      slotHint: "weapon" as const,
    },
    {
      key: "weapon-title-wide",
      mode: "item" as const,
      box: { x: 0.66, y: 0.14, w: 0.23, h: 0.11 },
      passes: ["soft", "red"] as const,
      priority: 320,
      slotHint: "weapon" as const,
    },
    {
      key: "weapon-list",
      mode: "item" as const,
      box: { x: 0.67, y: 0.10, w: 0.20, h: 0.30 },
      passes: ["soft", "red"] as const,
      priority: 260,
      slotHint: "weapon" as const,
    },
    {
      key: "armor-title-left",
      mode: "item" as const,
      box: { x: 0.30, y: 0.33, w: 0.22, h: 0.10 },
      passes: ["soft", "red"] as const,
      priority: 360,
      slotHint: "armor" as const,
    },
    {
      key: "armor-title-left-wide",
      mode: "item" as const,
      box: { x: 0.28, y: 0.30, w: 0.26, h: 0.15 },
      passes: ["soft", "red"] as const,
      priority: 320,
      slotHint: "armor" as const,
    },
    {
      key: "armor-selected-right",
      mode: "item" as const,
      box: { x: 0.68, y: 0.40, w: 0.20, h: 0.13 },
      passes: ["soft", "red"] as const,
      priority: 300,
      slotHint: "armor" as const,
    },
    {
      key: "item-detail-pane",
      mode: "item" as const,
      box: { x: 0.60, y: 0.12, w: 0.33, h: 0.56 },
      passes: ["soft", "hard"] as const,
      priority: 140,
      slotHint,
    },
    {
      key: "right-pane",
      mode: "item" as const,
      box: { x: 0.50, y: 0.06, w: 0.42, h: 0.78 },
      passes: ["soft", "hard"] as const,
      priority: 80,
      slotHint,
    },
    {
      key: "full",
      mode: "full" as const,
      box: { x: 0, y: 0, w: 1, h: 1 },
      passes: ["soft"] as const,
      priority: 20,
      slotHint: null,
    },
  ].filter((crop) => {
    if (slotHint === "weapon") return crop.slotHint !== "armor";
    if (slotHint === "armor") return crop.slotHint !== "weapon";
    return true;
  });

  const variants: OcrVariant[] = [];
  for (const crop of crops) {
    const sx = Math.max(0, Math.floor(width * crop.box.x));
    const sy = Math.max(0, Math.floor(height * crop.box.y));
    const sw = Math.min(width - sx, Math.max(1, Math.floor(width * crop.box.w)));
    const sh = Math.min(height - sy, Math.max(1, Math.floor(height * crop.box.h)));
    const targetWidth = Math.max(900, sw * 2);
    const targetHeight = Math.max(300, Math.floor((sh / sw) * targetWidth));

    for (const pass of crop.passes) {
      const canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas OCR не инициализировался.");

      if (pass === "soft") {
        ctx.filter = "grayscale(1) contrast(1.35) brightness(1.08)";
      } else if (pass === "hard") {
        ctx.filter = "grayscale(1) contrast(1.6) brightness(1.12)";
      } else if (pass === "white") {
        ctx.filter = "grayscale(1) contrast(1.48) brightness(1.2)";
      } else if (pass === "red") {
        ctx.filter = "contrast(1.35) saturate(1.2) brightness(1.08)";
      }

      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
      ctx.filter = "none";

      if (pass === "hard") {
        applyThreshold(ctx, targetWidth, targetHeight, 150);
      } else if (pass === "white") {
        applyLightTextMask(ctx, targetWidth, targetHeight, 178);
      } else if (pass === "red") {
        applyRedTextMask(ctx, targetWidth, targetHeight);
      }

      variants.push({
        key: `${crop.key}-${pass}`,
        mode: crop.mode,
        image: canvas,
        priority: crop.priority,
        slotHint: crop.slotHint ?? null,
      });
    }
  }

  return variants;
}
export async function analyzeGearScreenshotInBrowser({
  file,
  characters,
  searchOfficial,
  slotHint = null,
}: {
  file: File;
  characters: StalcraftCharacterCacheRow[];
  searchOfficial: (query: string, slot?: "weapon" | "armor" | null) => Promise<GearScreenshotSearchResult[]>;
  slotHint?: "weapon" | "armor" | null;
}): Promise<GearScreenshotAnalysis> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng+rus");

  try {
    const variants = await buildVariants(file, slotHint);
    const recognized: OcrTextResult[] = [];

    for (const variant of variants) {
      const params: Record<string, string> = {
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      };

      if (variant.mode === "nick") {
        params.tessedit_pageseg_mode = "7";
        params.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-.";
      } else {
        params.tessedit_pageseg_mode = variant.mode === "item" ? "6" : "11";
      }

      await worker.setParameters(params);
      const result = await worker.recognize(variant.image);
      recognized.push({
        key: variant.key,
        mode: variant.mode,
        text: cleanText(result?.data?.text) || "",
        priority: variant.priority || 0,
        slotHint: variant.slotHint ?? null,
      });
    }

    const nicknameMatch = matchNickname(recognized, characters);
    const itemMatch = await matchItem(recognized, searchOfficial, slotHint);
    return { nicknameMatch, itemMatch, recognized };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

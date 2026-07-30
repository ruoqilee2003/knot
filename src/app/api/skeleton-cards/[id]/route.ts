import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeywords,
} from "@/lib/keywords";
import {
  MAX_HEAT,
  isCardComplete,
  sanitizeBlocks,
  validateBlocks,
  type SkeletonBlock,
} from "@/lib/skeleton-cards";
import { isPresetSubject, normalizeSubject } from "@/lib/subjects";
import { findArchaeologyQuestionIdsByKeywords } from "@/lib/archaeology-link";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateSkeletonCardBody = {
  confidence?: number;
  heatIncrement?: boolean;
  heatDelta?: number;
  subject?: string;
  topic?: string;
  topicEn?: string;
  keywords?: string[];
  archaeologyQuestionIds?: string[];
  relatedCardIds?: string[];
  prompts?: string[];
  heat?: number;
  definition?: string;
  blocks?: Array<{
    label?: string;
    note?: string;
    count?: number;
    points?: Array<{ key?: string; hint?: string }>;
  }>;
  conclusion?: string;
  buildDurationSec?: number;
  isStub?: boolean;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const snap = await adminDb.collection("skeletonCards").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "找不到骨架卡" }, { status: 404 });
    }
    return NextResponse.json({ id: snap.id, ...(snap.data() as object) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch skeleton card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await adminDb.collection("skeletonCards").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete skeleton card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: UpdateSkeletonCardBody;
  try {
    body = (await request.json()) as UpdateSkeletonCardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ref = adminDb.collection("skeletonCards").doc(id);

  // 複習快速路徑：只更新信心值，不動其他欄位
  if (
    body.confidence === 0 ||
    body.confidence === 1 ||
    body.confidence === 2
  ) {
    try {
      await ref.set(
        {
          confidence: body.confidence,
          lastReviewedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to record review";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // 熱度快速 +1/-1（單人系統無併發疑慮，讀取後夾在 0-MAX_HEAT 寫回）
  if (body.heatIncrement === true || typeof body.heatDelta === "number") {
    const delta = body.heatIncrement === true ? 1 : body.heatDelta!;
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ error: "找不到骨架卡" }, { status: 404 });
      }
      const current = snap.data()?.heat;
      const heat = Math.max(
        0,
        Math.min(MAX_HEAT, (typeof current === "number" ? current : 0) + delta)
      );
      await ref.set({ heat, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true, heat });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to bump heat";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // 內容編輯模式
  const updates: Record<string, unknown> = {};

  if (typeof body.subject === "string") {
    const subject = normalizeSubject(body.subject);
    if (!isPresetSubject(subject)) {
      return NextResponse.json(
        { error: "科目必須是：資通網路、資通安全、資料庫應用、作業系統" },
        { status: 400 }
      );
    }
    updates.subject = subject;
  }

  if (typeof body.topic === "string") {
    const topic = body.topic.trim();
    if (!topic) {
      return NextResponse.json({ error: "topic 不能為空" }, { status: 400 });
    }
    updates.topic = topic;
  }

  if (typeof body.topicEn === "string") {
    updates.topicEn = body.topicEn.trim();
  }

  if (Array.isArray(body.keywords)) {
    const keywordDisplay = dedupeKeywordsCaseInsensitive(body.keywords);
    const keywords = normalizeKeywords(keywordDisplay);
    if (keywords.length === 0) {
      return NextResponse.json(
        { error: "至少需要一個關鍵字（骨架卡的主索引）" },
        { status: 400 }
      );
    }
    updates.keywords = keywords;
    updates.keywordDisplay = keywordDisplay;
  }

  if (Array.isArray(body.archaeologyQuestionIds)) {
    updates.archaeologyQuestionIds = Array.from(
      new Set(
        body.archaeologyQuestionIds.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0
        )
      )
    );
  }

  let nextRelatedCardIds: string[] | undefined;
  if (Array.isArray(body.relatedCardIds)) {
    nextRelatedCardIds = Array.from(
      new Set(
        body.relatedCardIds.filter(
          (item): item is string =>
            typeof item === "string" &&
            item.trim().length > 0 &&
            item !== id
        )
      )
    );
    updates.relatedCardIds = nextRelatedCardIds;
  }

  if (Array.isArray(body.prompts)) {
    updates.prompts = body.prompts
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof body.heat === "number" && Number.isFinite(body.heat)) {
    updates.heat = Math.min(MAX_HEAT, Math.max(0, Math.floor(body.heat)));
  }

  if (typeof body.definition === "string") {
    updates.definition = body.definition.trim();
  }

  if (typeof body.conclusion === "string") {
    updates.conclusion = body.conclusion.trim();
  }

  if (Array.isArray(body.blocks)) {
    const blocks = sanitizeBlocks(body.blocks);
    const blockError = validateBlocks(blocks);
    if (blockError) {
      return NextResponse.json({ error: blockError }, { status: 400 });
    }
    updates.blocks = blocks;
  }

  if (
    typeof body.buildDurationSec === "number" &&
    Number.isFinite(body.buildDurationSec)
  ) {
    updates.buildDurationSec = Math.max(0, Math.floor(body.buildDurationSec));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "At least one field is required" },
      { status: 400 }
    );
  }

  try {
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "找不到骨架卡" }, { status: 404 });
    }
    const existing = snap.data() as {
      subject?: string;
      keywords?: string[];
      archaeologyQuestionIds?: string[];
      definition?: string;
      conclusion?: string;
      blocks?: SkeletonBlock[];
      relatedCardIds?: string[];
    };

    // 關鍵字變更或儲存連結清單時，把同科、關鍵字有交集的考古題併入（只加不強制刪）
    if (
      Array.isArray(body.keywords) ||
      Array.isArray(body.archaeologyQuestionIds)
    ) {
      const subjectForMatch =
        typeof updates.subject === "string"
          ? updates.subject
          : String(existing.subject ?? "");
      const keywordsForMatch = Array.isArray(updates.keywords)
        ? (updates.keywords as string[])
        : normalizeKeywords(existing.keywords);
      const autoLinked = await findArchaeologyQuestionIdsByKeywords(
        subjectForMatch,
        keywordsForMatch
      );
      const explicit = Array.isArray(updates.archaeologyQuestionIds)
        ? (updates.archaeologyQuestionIds as string[])
        : Array.isArray(existing.archaeologyQuestionIds)
          ? existing.archaeologyQuestionIds
          : [];
      updates.archaeologyQuestionIds = Array.from(
        new Set([...explicit, ...autoLinked])
      );
    }

    const merged = {
      definition:
        typeof updates.definition === "string"
          ? updates.definition
          : existing.definition,
      conclusion:
        typeof updates.conclusion === "string"
          ? updates.conclusion
          : existing.conclusion,
      blocks: Array.isArray(updates.blocks)
        ? (updates.blocks as SkeletonBlock[])
        : existing.blocks ?? [],
    };
    // isStub 預設由內容完整度自動判斷，但編輯頁可以明確指定要存成卡樁還是骨架卡
    updates.isStub =
      typeof body.isStub === "boolean" ? body.isStub : !isCardComplete(merged);
    updates.updatedAt = FieldValue.serverTimestamp();

    const batch = adminDb.batch();
    batch.set(ref, updates, { merge: true });

    // 關聯骨架卡是雙向的：新增/移除連結時，同步把自己的 id 加進/移出對方的 relatedCardIds
    if (nextRelatedCardIds) {
      const previousRelatedCardIds = Array.isArray(existing.relatedCardIds)
        ? existing.relatedCardIds
        : [];
      const nextSet = new Set(nextRelatedCardIds);
      const prevSet = new Set(previousRelatedCardIds);
      const added = nextRelatedCardIds.filter((cid) => !prevSet.has(cid));
      const removed = previousRelatedCardIds.filter((cid) => !nextSet.has(cid));
      for (const cid of added) {
        batch.set(
          adminDb.collection("skeletonCards").doc(cid),
          { relatedCardIds: FieldValue.arrayUnion(id) },
          { merge: true }
        );
      }
      for (const cid of removed) {
        batch.set(
          adminDb.collection("skeletonCards").doc(cid),
          { relatedCardIds: FieldValue.arrayRemove(id) },
          { merge: true }
        );
      }
    }

    await batch.commit();
    return NextResponse.json({ ok: true, isStub: updates.isStub });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update skeleton card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

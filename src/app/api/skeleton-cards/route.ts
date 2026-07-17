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
} from "@/lib/skeleton-cards";

export const runtime = "nodejs";

function getCreatedAtMillis(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toMillis?: () => number };
  if (typeof candidate.toMillis === "function") {
    const millis = candidate.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

type CreateSkeletonCardBody = {
  subject?: string;
  topic?: string;
  topicEn?: string;
  keywords?: string[];
  archaeologyQuestionIds?: string[];
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
  allowDuplicate?: boolean;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject")?.trim() ?? "";

    // 有 subject 篩選時不能跟 orderBy 疊在一起查（會需要額外的 Firestore 複合索引），
    // 改成撈回後在記憶體排序，比照 questions/route.ts 的作法。
    let query: FirebaseFirestore.Query = adminDb.collection("skeletonCards");
    if (subject) {
      query = query.where("subject", "==", subject);
    } else {
      query = query.orderBy("createdAt", "desc");
    }
    const snapshot = await query.limit(500).get();
    let cards = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));
    if (subject) {
      cards = cards
        .sort(
          (a, b) =>
            getCreatedAtMillis((b as { createdAt?: unknown }).createdAt) -
            getCreatedAtMillis((a as { createdAt?: unknown }).createdAt)
        )
        .slice(0, 500);
    }
    return NextResponse.json(cards);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch skeleton cards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: CreateSkeletonCardBody;
  try {
    body = (await request.json()) as CreateSkeletonCardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const topicEn = typeof body.topicEn === "string" ? body.topicEn.trim() : "";
  const keywordDisplay = dedupeKeywordsCaseInsensitive(
    Array.isArray(body.keywords) ? body.keywords : []
  );
  const keywords = normalizeKeywords(keywordDisplay);

  if (!subject || !topic) {
    return NextResponse.json(
      { error: "subject and topic are required" },
      { status: 400 }
    );
  }
  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "至少需要一個關鍵字（骨架卡的主索引）" },
      { status: 400 }
    );
  }

  const archaeologyQuestionIds = Array.from(
    new Set(
      Array.isArray(body.archaeologyQuestionIds)
        ? body.archaeologyQuestionIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0
          )
        : []
    )
  );

  const definition =
    typeof body.definition === "string" ? body.definition.trim() : "";
  const conclusion =
    typeof body.conclusion === "string" ? body.conclusion.trim() : "";
  const blocks = sanitizeBlocks(body.blocks);
  const blockError = validateBlocks(blocks);
  if (blockError) {
    return NextResponse.json({ error: blockError }, { status: 400 });
  }
  const heat = Math.min(
    MAX_HEAT,
    Math.max(
      0,
      typeof body.heat === "number" && Number.isFinite(body.heat)
        ? Math.floor(body.heat)
        : 0
    )
  );
  const allowDuplicate = body.allowDuplicate === true;

  try {
    let prompts = Array.isArray(body.prompts)
      ? body.prompts
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];

    if (prompts.length === 0 && archaeologyQuestionIds.length > 0) {
      const questionSnaps = await adminDb.getAll(
        ...archaeologyQuestionIds.map((id) =>
          adminDb.collection("questions").doc(id)
        )
      );
      prompts = questionSnaps
        .filter((snap) => snap.exists)
        .map((snap) => {
          const data = snap.data() as {
            questionText?: string;
            title?: string;
          };
          const text = String(data.questionText ?? data.title ?? "").trim();
          return text.length > 40 ? `${text.slice(0, 40)}…` : text;
        })
        .filter(Boolean);
    }

    if (!allowDuplicate) {
      const sameSubjectSnapshot = await adminDb
        .collection("skeletonCards")
        .where("subject", "==", subject)
        .select("topic", "keywords")
        .limit(500)
        .get();

      const keywordSet = new Set(keywords);
      const duplicates = sameSubjectSnapshot.docs
        .map((doc) => {
          const data = doc.data() as { topic?: string; keywords?: string[] };
          const existingKeywords = Array.isArray(data.keywords)
            ? data.keywords
            : [];
          const matchedKeywords = existingKeywords.filter((keyword) =>
            keywordSet.has(keyword)
          );
          return {
            id: doc.id,
            topic: String(data.topic ?? ""),
            matchedKeywords,
          };
        })
        .filter((item) => item.matchedKeywords.length > 0)
        .slice(0, 5);

      if (duplicates.length > 0) {
        return NextResponse.json(
          { error: "偵測到相同關鍵字的骨架卡，可能已經存在", duplicates },
          { status: 409 }
        );
      }
    }

    const isStub = !isCardComplete({ definition, conclusion, blocks });

    const payload = {
      subject,
      topic,
      topicEn,
      keywords,
      keywordDisplay,
      archaeologyQuestionIds,
      relatedCardIds: [] as string[],
      prompts,
      heat,
      isStub,
      definition,
      blocks,
      conclusion,
      confidence: 0,
      lastReviewedAt: null,
      buildDurationSec: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await adminDb.collection("skeletonCards").add(payload);
    return NextResponse.json({ id: ref.id, isStub }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create skeleton card";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

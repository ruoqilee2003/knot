import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getActiveKeywordStats, filterActiveKeywordsByQuery } from "@/lib/active-keywords";
import { getArchivedQuestionIds } from "@/lib/archive";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  sanitizeKeyword,
} from "@/lib/keywords";

export const runtime = "nodejs";

type CreateKeywordBody = {
  keyword?: string;
  keywords?: string[];
};

async function upsertKeywords(input: string[]) {
  const displayKeywords = dedupeKeywordsCaseInsensitive(input);
  if (displayKeywords.length === 0) return;
  const batch = adminDb.batch();
  for (const item of displayKeywords) {
    const keyword = normalizeKeyword(item);
    if (!keyword) continue;
    const ref = adminDb.collection("keywords").doc(keyword);
    batch.set(
      ref,
      {
        keyword,
        displayKeyword: sanitizeKeyword(item),
        usageCount: FieldValue.increment(1),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = normalizeKeyword(searchParams.get("query") ?? "");
    const limit = Number(searchParams.get("limit") ?? 20);
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;

    const archivedIds = await getArchivedQuestionIds();
    const activeStats = await getActiveKeywordStats(archivedIds, 500);
    const filtered = filterActiveKeywordsByQuery(
      activeStats,
      query,
      safeLimit
    );

    const data = filtered.map((item) => ({
      id: item.normalized,
      keyword: item.keyword,
      usageCount: item.usageCount,
    }));

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch keywords";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: CreateKeywordBody;
  try {
    body = (await request.json()) as CreateKeywordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const singleKeyword = typeof body.keyword === "string" ? body.keyword : "";
  const multiKeywords = Array.isArray(body.keywords) ? body.keywords : [];
  const keywords = dedupeKeywordsCaseInsensitive(
    [singleKeyword, ...multiKeywords].filter((item) => typeof item === "string")
  );

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: "keyword or keywords is required" },
      { status: 400 }
    );
  }

  try {
    await upsertKeywords(keywords);
    return NextResponse.json({ ok: true, keywords }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create keywords";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

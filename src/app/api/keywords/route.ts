import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  dedupeKeywordsCaseInsensitive,
  normalizeKeyword,
  sanitizeKeyword,
} from "@/lib/keywords";

export const runtime = "nodejs";

type KeywordDoc = {
  keyword: string;
  displayKeyword: string;
  usageCount: number;
  createdAt: unknown;
  updatedAt: unknown;
};

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

    let snapshot: FirebaseFirestore.QuerySnapshot;
    if (query) {
      snapshot = await adminDb
        .collection("keywords")
        .orderBy("keyword")
        .startAt(query)
        .endAt(`${query}\uf8ff`)
        .limit(safeLimit)
        .get();
    } else {
      snapshot = await adminDb
        .collection("keywords")
        .orderBy("usageCount", "desc")
        .limit(safeLimit)
        .get();
    }

    const data = snapshot.docs.map((doc) => {
      const raw = doc.data() as Partial<KeywordDoc>;
      return {
        id: doc.id,
        keyword:
          typeof raw.displayKeyword === "string" && raw.displayKeyword.trim()
            ? raw.displayKeyword
            : typeof raw.keyword === "string"
              ? raw.keyword
              : doc.id,
        usageCount:
          typeof raw.usageCount === "number" && Number.isFinite(raw.usageCount)
            ? raw.usageCount
            : 0,
      };
    });

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

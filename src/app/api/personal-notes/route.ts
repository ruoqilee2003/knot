import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { dedupeKeywordsCaseInsensitive, normalizeKeywords } from "@/lib/keywords";

export const runtime = "nodejs";

type PersonalNoteBody = {
  body?: string;
  questionId?: string;
  subject?: string;
  keywords?: string[];
  keywordDisplay?: string[];
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const questionId = searchParams.get("questionId")?.trim() ?? "";
    const keyword = searchParams.get("keyword")?.trim().toLowerCase() ?? "";

    let query: FirebaseFirestore.Query = adminDb.collection("personalNotes");

    if (questionId) {
      query = query.where("questionId", "==", questionId);
    }
    if (keyword) {
      query = query.where("keywords", "array-contains", keyword);
    }

    const snapshot = await query.limit(200).get();
    const notes = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .sort((a, b) => {
        const left = (() => {
          const value = (a as { updatedAt?: { toMillis?: () => number } }).updatedAt;
          return typeof value?.toMillis === "function" ? value.toMillis() : 0;
        })();
        const right = (() => {
          const value = (b as { updatedAt?: { toMillis?: () => number } }).updatedAt;
          return typeof value?.toMillis === "function" ? value.toMillis() : 0;
        })();
        return right - left;
      });
    return NextResponse.json(notes);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch personal notes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: PersonalNoteBody;
  try {
    body = (await request.json()) as PersonalNoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const keywordDisplay = dedupeKeywordsCaseInsensitive(
    Array.isArray(body.keywordDisplay) ? body.keywordDisplay : body.keywords ?? []
  );
  const keywords = normalizeKeywords(keywordDisplay);

  if (!noteBody || !questionId) {
    return NextResponse.json(
      { error: "body and questionId are required" },
      { status: 400 }
    );
  }

  try {
    const ref = await adminDb.collection("personalNotes").add({
      body: noteBody,
      questionId,
      subject,
      keywords,
      keywordDisplay,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create personal note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

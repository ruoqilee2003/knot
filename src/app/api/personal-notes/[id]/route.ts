import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { dedupeKeywordsCaseInsensitive, normalizeKeywords } from "@/lib/keywords";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdatePersonalNoteBody = {
  body?: string;
  keywords?: string[];
  keywordDisplay?: string[];
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "Missing personal note id" },
      { status: 400 }
    );
  }

  try {
    await adminDb.collection("personalNotes").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete personal note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "Missing personal note id" },
      { status: 400 }
    );
  }

  let body: UpdatePersonalNoteBody;
  try {
    body = (await request.json()) as UpdatePersonalNoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (typeof body.body === "string") {
    updates.body = body.body.trim();
  }
  if (Array.isArray(body.keywordDisplay) || Array.isArray(body.keywords)) {
    const keywordDisplay = dedupeKeywordsCaseInsensitive(
      Array.isArray(body.keywordDisplay) ? body.keywordDisplay : body.keywords ?? []
    );
    updates.keywordDisplay = keywordDisplay;
    updates.keywords = normalizeKeywords(keywordDisplay);
  }

  if (
    !("body" in updates) &&
    !("keywords" in updates) &&
    !("keywordDisplay" in updates)
  ) {
    return NextResponse.json(
      { error: "At least one field is required" },
      { status: 400 }
    );
  }

  try {
    await adminDb.collection("personalNotes").doc(id).set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update personal note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

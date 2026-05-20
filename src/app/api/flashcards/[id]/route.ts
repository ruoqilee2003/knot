import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateFlashcardBody = {
  front?: string;
  back?: string;
  frontHtml?: string;
  backHtml?: string;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing flashcard id" }, { status: 400 });
  }

  try {
    await adminDb.collection("flashcards").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete flashcard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing flashcard id" }, { status: 400 });
  }

  let body: UpdateFlashcardBody;
  try {
    body = (await request.json()) as UpdateFlashcardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.front === "string") {
    updates.front = body.front.trim();
  }
  if (typeof body.back === "string") {
    updates.back = body.back.trim();
  }
  if (typeof body.frontHtml === "string") {
    updates.frontHtml = body.frontHtml;
  }
  if (typeof body.backHtml === "string") {
    updates.backHtml = body.backHtml;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "At least one field is required" },
      { status: 400 }
    );
  }

  if (
    ("front" in updates && !String(updates.front)) ||
    ("back" in updates && !String(updates.back))
  ) {
    return NextResponse.json(
      { error: "front and back cannot be empty" },
      { status: 400 }
    );
  }

  try {
    await adminDb.collection("flashcards").doc(id).set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update flashcard";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateNoteBody = {
  title?: string;
  body?: string;
  bodyHtml?: string;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing note id" }, { status: 400 });
  }

  try {
    await adminDb.collection("studyNotes").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing note id" }, { status: 400 });
  }

  let body: UpdateNoteBody;
  try {
    body = (await request.json()) as UpdateNoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    updates.title = body.title.trim() || "未命名題目";
  }
  if (typeof body.body === "string") {
    updates.body = body.body.trim();
  }
  if (typeof body.bodyHtml === "string") {
    updates.bodyHtml = body.bodyHtml;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "At least one field is required" },
      { status: 400 }
    );
  }

  try {
    await adminDb.collection("studyNotes").doc(id).set(updates, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateBody = {
  /** 作答結果回報：答對或答錯，會遞增對應計數 */
  result?: "correct" | "wrong";
  /** 標記「想再看一次」 */
  marked?: boolean;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing quiz question id" }, { status: 400 });
  }
  try {
    await adminDb.collection("quizQuestions").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete quiz question";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing quiz question id" }, { status: 400 });
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body.marked === "boolean") {
      await adminDb
        .collection("quizQuestions")
        .doc(id)
        .set({ marked: body.marked }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (body.result !== "correct" && body.result !== "wrong") {
      return NextResponse.json(
        { error: "result must be 'correct' or 'wrong'" },
        { status: 400 }
      );
    }

    const field = body.result === "correct" ? "correctCount" : "wrongCount";
    await adminDb
      .collection("quizQuestions")
      .doc(id)
      .set(
        {
          [field]: FieldValue.increment(1),
          lastResult: body.result,
          lastAnsweredAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to record quiz answer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

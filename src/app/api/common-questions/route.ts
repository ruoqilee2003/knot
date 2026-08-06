import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { parseCommonQuestionsMarkdown } from "@/lib/common-questions";

export const runtime = "nodejs";

type ImportBody = {
  markdown?: string;
  examName?: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const examName = searchParams.get("examName")?.trim() ?? "";

    const snapshot = await adminDb.collection("commonQuestions").get();

    let items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    })) as Array<{ id: string; examName?: string; number?: number }>;

    if (examName) {
      items = items.filter((item) => item.examName === examName);
    }

    items.sort((a, b) => {
      const examCompare = (a.examName ?? "").localeCompare(b.examName ?? "");
      if (examCompare !== 0) return examCompare;
      return (a.number ?? 0) - (b.number ?? 0);
    });

    return NextResponse.json(items);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch common questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 刪除整份題庫：DELETE /api/common-questions?examName=xxx */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const examName = searchParams.get("examName")?.trim() ?? "";
  if (!examName) {
    return NextResponse.json({ error: "examName is required" }, { status: 400 });
  }
  try {
    const snapshot = await adminDb
      .collection("commonQuestions")
      .where("examName", "==", examName)
      .get();
    if (snapshot.empty) {
      return NextResponse.json({ deleted: 0 });
    }
    const batch = adminDb.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return NextResponse.json({ deleted: snapshot.size });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete common questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!markdown.trim()) {
    return NextResponse.json({ error: "缺少 markdown 內容" }, { status: 400 });
  }

  const parsed = parseCommonQuestionsMarkdown(markdown);
  const examName =
    (typeof body.examName === "string" && body.examName.trim()) ||
    parsed.examName ||
    "未命名題庫";

  if (parsed.questions.length === 0) {
    return NextResponse.json(
      { error: "沒有解析到任何選擇題，請確認檔案格式" },
      { status: 400 }
    );
  }

  try {
    const existingSnapshot = await adminDb
      .collection("commonQuestions")
      .where("examName", "==", examName)
      .get();
    const existingNumbers = new Set(
      existingSnapshot.docs.map(
        (doc) => (doc.data() as { number?: number }).number
      )
    );

    const toCreate = parsed.questions.filter(
      (q) => !existingNumbers.has(q.number)
    );

    if (toCreate.length === 0) {
      return NextResponse.json(
        {
          examName,
          imported: 0,
          skipped: parsed.questions.length,
          total: parsed.questions.length,
        },
        { status: 200 }
      );
    }

    const batch = adminDb.batch();
    for (const q of toCreate) {
      const ref = adminDb.collection("commonQuestions").doc();
      batch.set(ref, {
        examName,
        subjectLabel: q.subjectLabel,
        number: q.number,
        stem: q.stem,
        options: q.options,
        answerIndex: q.answerIndex,
        passage: q.passage,
        explanation: null,
        correctCount: 0,
        wrongCount: 0,
        lastResult: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    return NextResponse.json(
      {
        examName,
        imported: toCreate.length,
        skipped: parsed.questions.length - toCreate.length,
        total: parsed.questions.length,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to import common questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { isQuestionArchived } from "@/lib/archive";

export const runtime = "nodejs";

type ArchiveBody = {
  action?: "archiveAll" | "restoreAll";
};

async function countQuestions(filterArchived: boolean): Promise<number> {
  const snap = await adminDb.collection("questions").select("archived").get();
  return snap.docs.filter((doc) =>
    filterArchived
      ? isQuestionArchived(doc.data())
      : !isQuestionArchived(doc.data())
  ).length;
}

export async function GET() {
  try {
    const [archivedCount, activeCount] = await Promise.all([
      countQuestions(true),
      countQuestions(false),
    ]);
    return NextResponse.json({ archivedCount, activeCount });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch archive status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: ArchiveBody;
  try {
    body = (await request.json()) as ArchiveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "archiveAll" && action !== "restoreAll") {
    return NextResponse.json(
      { error: "action must be archiveAll or restoreAll" },
      { status: 400 }
    );
  }

  try {
    const snap = await adminDb.collection("questions").select("archived").get();
    const targets = snap.docs.filter((doc) => {
      const archived = isQuestionArchived(doc.data());
      return action === "archiveAll" ? !archived : archived;
    });

    if (targets.length === 0) {
      return NextResponse.json({
        updated: 0,
        action,
      });
    }

    let batch = adminDb.batch();
    let opCount = 0;
    let updated = 0;

    for (const doc of targets) {
      if (action === "archiveAll") {
        batch.set(
          doc.ref,
          {
            archived: true,
            archivedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        batch.set(
          doc.ref,
          {
            archived: false,
            archivedAt: FieldValue.delete(),
          },
          { merge: true }
        );
      }
      opCount += 1;
      updated += 1;
      if (opCount >= 450) {
        await batch.commit();
        batch = adminDb.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({ updated, action });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update archive status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

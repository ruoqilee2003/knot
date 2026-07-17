import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { isQuestionArchived } from "@/lib/archive";

export const runtime = "nodejs";

type ArchiveBody = {
  action?: "archiveAll" | "restoreAll" | "deleteAllArchived";
};

const FIRESTORE_IN_QUERY_LIMIT = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

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
  if (
    action !== "archiveAll" &&
    action !== "restoreAll" &&
    action !== "deleteAllArchived"
  ) {
    return NextResponse.json(
      { error: "action must be archiveAll, restoreAll or deleteAllArchived" },
      { status: 400 }
    );
  }

  if (action === "deleteAllArchived") {
    try {
      const snap = await adminDb
        .collection("questions")
        .select("archived")
        .get();
      const archivedIds = snap.docs
        .filter((doc) => isQuestionArchived(doc.data()))
        .map((doc) => doc.id);

      if (archivedIds.length === 0) {
        return NextResponse.json({ deleted: 0, action });
      }

      const [flashcardRefs, noteRefs, personalNoteRefs] = await Promise.all(
        (
          [
            "flashcards",
            "studyNotes",
            "personalNotes",
          ] as const
        ).map(async (collectionName) => {
          const refs: FirebaseFirestore.DocumentReference[] = [];
          for (const idsChunk of chunk(archivedIds, FIRESTORE_IN_QUERY_LIMIT)) {
            const chunkSnap = await adminDb
              .collection(collectionName)
              .where("questionId", "in", idsChunk)
              .get();
            refs.push(...chunkSnap.docs.map((doc) => doc.ref));
          }
          return refs;
        })
      );

      const refsToDelete = [
        ...archivedIds.map((id) => adminDb.collection("questions").doc(id)),
        ...archivedIds.map((id) => adminDb.collection("attempts").doc(id)),
        ...flashcardRefs,
        ...noteRefs,
        ...personalNoteRefs,
      ];

      let batch = adminDb.batch();
      let opCount = 0;
      for (const ref of refsToDelete) {
        batch.delete(ref);
        opCount += 1;
        if (opCount >= 450) {
          await batch.commit();
          batch = adminDb.batch();
          opCount = 0;
        }
      }
      if (opCount > 0) {
        await batch.commit();
      }

      return NextResponse.json({
        deleted: archivedIds.length,
        action,
        details: {
          questions: archivedIds.length,
          flashcards: flashcardRefs.length,
          notes: noteRefs.length,
          personalNotes: personalNoteRefs.length,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete archived questions";
      return NextResponse.json({ error: message }, { status: 500 });
    }
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

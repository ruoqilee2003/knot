import { adminDb } from "@/lib/firebase-admin";

export type QuestionArchiveFields = {
  archived?: boolean;
  archivedAt?: unknown;
};

export function isQuestionArchived(
  data: QuestionArchiveFields | undefined
): boolean {
  return data?.archived === true;
}

export async function getArchivedQuestionIds(): Promise<Set<string>> {
  const snap = await adminDb
    .collection("questions")
    .where("archived", "==", true)
    .select()
    .get();
  return new Set(snap.docs.map((doc) => doc.id));
}

export function filterByActiveQuestions<T extends { questionId?: string }>(
  items: T[],
  archivedIds: Set<string>
): T[] {
  if (archivedIds.size === 0) return items;
  return items.filter((item) => {
    const questionId =
      typeof item.questionId === "string" ? item.questionId : "";
    return !questionId || !archivedIds.has(questionId);
  });
}

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { sanitizeCanvasEdges, sanitizeCanvasNodes } from "@/lib/mindmap-canvas";
import { isPresetSubject, normalizeSubject } from "@/lib/subjects";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ subject: string }>;
};

function resolveSubject(rawSubject: string): string | null {
  const subject = normalizeSubject(decodeURIComponent(rawSubject));
  return isPresetSubject(subject) ? subject : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { subject: rawSubject } = await context.params;
  const subject = resolveSubject(rawSubject);
  if (!subject) {
    return NextResponse.json({ error: "科目不存在" }, { status: 400 });
  }
  try {
    const snap = await adminDb.collection("mindMaps").doc(subject).get();
    if (!snap.exists) {
      return NextResponse.json({ subject, nodes: [], edges: [] });
    }
    const data = snap.data() as { nodes?: unknown; edges?: unknown };
    const nodes = sanitizeCanvasNodes(data.nodes);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = sanitizeCanvasEdges(data.edges, nodeIds);
    return NextResponse.json({ subject, nodes, edges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "讀取心智圖失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { subject: rawSubject } = await context.params;
  const subject = resolveSubject(rawSubject);
  if (!subject) {
    return NextResponse.json({ error: "科目不存在" }, { status: 400 });
  }
  let body: { nodes?: unknown; edges?: unknown };
  try {
    body = (await request.json()) as { nodes?: unknown; edges?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nodes = sanitizeCanvasNodes(body.nodes);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = sanitizeCanvasEdges(body.edges, nodeIds);

  try {
    await adminDb.collection("mindMaps").doc(subject).set({
      subject,
      nodes,
      edges,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ subject, nodes, edges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "儲存心智圖失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

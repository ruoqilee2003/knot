export const MINDMAP_ROOT_ID = "__root__";

export type MindMapCanvasNodeKind = "card" | "text";

export type MindMapCanvasNode = {
  id: string;
  kind: MindMapCanvasNodeKind;
  /** 僅 kind === "card" 時有值：指到 skeletonCards 的文件 id */
  cardId?: string;
  /** 僅 kind === "text" 時有值：自由文字節點的內容 */
  label?: string;
  x: number;
  y: number;
  /** 是否收合子節點（依 root 的 BFS 樹判斷子節點）；未設定時由前端依深度決定預設值 */
  collapsed?: boolean;
};

export type MindMapCanvasEdge = {
  id: string;
  /** 節點 id，或 MINDMAP_ROOT_ID 代表科目中心 */
  fromId: string;
  toId: string;
  label?: string;
};

export type MindMapCanvasState = {
  nodes: MindMapCanvasNode[];
  edges: MindMapCanvasEdge[];
};

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 把 API 收到的原始節點陣列清理成可寫進 Firestore 的形狀；不合法的節點直接丟棄 */
export function sanitizeCanvasNodes(input: unknown): MindMapCanvasNode[] {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set<string>();
  const nodes: MindMapCanvasNode[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || id === MINDMAP_ROOT_ID || seenIds.has(id)) continue;
    const kind = item.kind === "card" || item.kind === "text" ? item.kind : null;
    if (!kind) continue;
    const x = toFiniteNumber(item.x, 0);
    const y = toFiniteNumber(item.y, 0);
    const collapsed = typeof item.collapsed === "boolean" ? item.collapsed : undefined;
    if (kind === "card") {
      const cardId = typeof item.cardId === "string" ? item.cardId.trim() : "";
      if (!cardId) continue;
      nodes.push(
        collapsed === undefined
          ? { id, kind, cardId, x, y }
          : { id, kind, cardId, x, y, collapsed }
      );
    } else {
      const label = typeof item.label === "string" ? item.label.trim() : "";
      nodes.push(
        collapsed === undefined
          ? { id, kind, label, x, y }
          : { id, kind, label, x, y, collapsed }
      );
    }
    seenIds.add(id);
  }
  return nodes;
}

/** 邊只能連到存在的節點或科目中心；起訖相同的自我連線直接丟棄 */
export function sanitizeCanvasEdges(
  input: unknown,
  validNodeIds: Set<string>
): MindMapCanvasEdge[] {
  if (!Array.isArray(input)) return [];
  const seenPairs = new Set<string>();
  const edges: MindMapCanvasEdge[] = [];
  const isValidEndpoint = (id: string) => id === MINDMAP_ROOT_ID || validNodeIds.has(id);
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const fromId = typeof item.fromId === "string" ? item.fromId.trim() : "";
    const toId = typeof item.toId === "string" ? item.toId.trim() : "";
    if (!id || !fromId || !toId || fromId === toId) continue;
    if (!isValidEndpoint(fromId) || !isValidEndpoint(toId)) continue;
    const pairKey = [fromId, toId].sort().join("::");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    edges.push(label ? { id, fromId, toId, label } : { id, fromId, toId });
  }
  return edges;
}

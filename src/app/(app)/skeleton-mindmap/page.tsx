"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PRESET_SUBJECTS } from "@/lib/subjects";
import type { SkeletonBlock } from "@/lib/skeleton-cards";
import {
  MINDMAP_ROOT_ID,
  type MindMapCanvasEdge,
  type MindMapCanvasNode,
} from "@/lib/mindmap-canvas";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

type MindMapCard = {
  id: string;
  subject: string;
  topic: string;
  topicEn: string;
  keywordDisplay: string[];
  archaeologyQuestionIds: string[];
  relatedCardIds: string[];
  heat: number;
  isStub: boolean;
  confidence: number;
  definition: string;
  blocks: SkeletonBlock[];
  conclusion: string;
};

const VIEWBOX_SIZE = 1600;
const VIEWBOX_HALF = VIEWBOX_SIZE / 2;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const DRAG_THRESHOLD_PX = 4;
const GOLDEN_ANGLE = 2.399963;

function parseCards(data: Array<Record<string, unknown>>): MindMapCard[] {
  return data.map((x) => ({
    id: String(x.id ?? ""),
    subject: String(x.subject ?? ""),
    topic: String(x.topic ?? ""),
    topicEn: String(x.topicEn ?? ""),
    keywordDisplay: Array.isArray(x.keywordDisplay)
      ? (x.keywordDisplay as unknown[]).filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    archaeologyQuestionIds: Array.isArray(x.archaeologyQuestionIds)
      ? (x.archaeologyQuestionIds as unknown[]).filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    relatedCardIds: Array.isArray(x.relatedCardIds)
      ? (x.relatedCardIds as unknown[]).filter(
          (item): item is string => typeof item === "string"
        )
      : [],
    heat: typeof x.heat === "number" ? x.heat : 0,
    isStub: x.isStub !== false,
    confidence: typeof x.confidence === "number" ? x.confidence : 0,
    definition: String(x.definition ?? ""),
    blocks: Array.isArray(x.blocks) ? (x.blocks as SkeletonBlock[]) : [],
    conclusion: String(x.conclusion ?? ""),
  }));
}

function nextSpiralPosition(index: number): { x: number; y: number } {
  const angle = index * GOLDEN_ANGLE;
  const radius = 50 + index * 24;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function textNodeWidth(label: string): number {
  return Math.max(60, Math.min(220, 16 + label.length * 7));
}

export default function SkeletonMindMapPage() {
  const [subject, setSubject] = useState<string>(PRESET_SUBJECTS[0]);
  const [cards, setCards] = useState<MindMapCard[]>([]);
  const [nodes, setNodes] = useState<MindMapCanvasNode[]>([]);
  const [edges, setEdges] = useState<MindMapCanvasEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [search, setSearch] = useState("");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panDragRef = useRef({ x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    ratio: number;
    moved: boolean;
  } | null>(null);

  const skipNextSaveRef = useRef(true);

  // 切換科目：重新載入該科的骨架卡（供挑選）與已儲存的畫布
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectMode(false);
    setConnectFromId(null);
    setPickerOpen(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
    skipNextSaveRef.current = true;
    (async () => {
      try {
        const [cardsRes, mapRes] = await Promise.all([
          fetch(`/api/skeleton-cards?${new URLSearchParams({ subject }).toString()}`),
          fetch(`/api/mindmaps/${encodeURIComponent(subject)}`),
        ]);
        if (!cardsRes.ok) throw new Error("讀取骨架卡失敗");
        if (!mapRes.ok) throw new Error("讀取心智圖失敗");
        const cardsData = (await cardsRes.json()) as Array<Record<string, unknown>>;
        const mapData = (await mapRes.json()) as {
          nodes: MindMapCanvasNode[];
          edges: MindMapCanvasEdge[];
        };
        if (cancelled) return;
        setCards(parseCards(cardsData));
        setNodes(mapData.nodes ?? []);
        setEdges(mapData.edges ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "讀取失敗");
          setCards([]);
          setNodes([]);
          setEdges([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject]);

  // 節點/連線變動時 debounce 自動存回該科目的心智圖文件
  useEffect(() => {
    if (loading) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    setSaveStatus("saving");
    const timer = setTimeout(() => {
      void fetch(`/api/mindmaps/${encodeURIComponent(subject)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      })
        .then((res) => setSaveStatus(res.ok ? "saved" : "idle"))
        .catch(() => setSaveStatus("idle"));
    }, 800);
    return () => clearTimeout(timer);
  }, [nodes, edges, subject, loading]);

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const canvasCardIds = useMemo(
    () => new Set(nodes.filter((n) => n.kind === "card").map((n) => n.cardId)),
    [nodes]
  );

  // 從科目中心做 BFS，算出每個節點的深度與樹狀親子關係，供收合/展開判斷用
  // （手動拉的跨層連線不影響深度，因為只有「第一次抵達」的那條邊會被當成樹邊）
  const treeInfo = useMemo(() => {
    const adjacency = new Map<string, string[]>();
    const addAdj = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a)!.push(b);
    };
    for (const e of edges) {
      addAdj(e.fromId, e.toId);
      addAdj(e.toId, e.fromId);
    }
    const depthOf = new Map<string, number>([[MINDMAP_ROOT_ID, 0]]);
    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    const visited = new Set<string>([MINDMAP_ROOT_ID]);
    const queue = [MINDMAP_ROOT_ID];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adjacency.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        depthOf.set(next, (depthOf.get(cur) ?? 0) + 1);
        parentOf.set(next, cur);
        if (!childrenOf.has(cur)) childrenOf.set(cur, []);
        childrenOf.get(cur)!.push(next);
        queue.push(next);
      }
    }
    return { depthOf, parentOf, childrenOf };
  }, [edges]);

  // 節點是否「展開」（是否顯示它自己的子節點）：未手動設定過時，
  // 第一層（章節／直接連到中心的節點）預設展開，第二層以下預設收合，
  // 這樣末梢節點要點上一層才會出現，避免大量節點一次全部畫出來卡頓。
  const isNodeExpanded = useCallback(
    (nodeId: string): boolean => {
      const node = nodesById.get(nodeId);
      if (node?.collapsed === true) return false;
      if (node?.collapsed === false) return true;
      const depth = treeInfo.depthOf.get(nodeId);
      return depth === undefined ? true : depth <= 1;
    },
    [nodesById, treeInfo]
  );

  const visibleNodeIds = useMemo(() => {
    // 搜尋中直接無視收合狀態，全部節點都找得到
    if (search.trim()) return new Set(nodes.map((n) => n.id));
    const visible = new Set<string>();
    for (const node of nodes) {
      const depth = treeInfo.depthOf.get(node.id);
      if (depth === undefined) {
        visible.add(node.id); // 還沒連到中心的獨立節點，一律顯示
        continue;
      }
      let cur = treeInfo.parentOf.get(node.id);
      let ok = true;
      while (cur !== undefined && cur !== MINDMAP_ROOT_ID) {
        if (!isNodeExpanded(cur)) {
          ok = false;
          break;
        }
        cur = treeInfo.parentOf.get(cur);
      }
      if (ok) visible.add(node.id);
    }
    return visible;
  }, [nodes, treeInfo, isNodeExpanded, search]);

  const visibleNodes = useMemo(
    () => nodes.filter((n) => visibleNodeIds.has(n.id)),
    [nodes, visibleNodeIds]
  );
  const visibleEdges = useMemo(
    () =>
      edges.filter((e) => {
        const fromVisible = e.fromId === MINDMAP_ROOT_ID || visibleNodeIds.has(e.fromId);
        const toVisible = e.toId === MINDMAP_ROOT_ID || visibleNodeIds.has(e.toId);
        return fromVisible && toVisible;
      }),
    [edges, visibleNodeIds]
  );

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      const expanded = isNodeExpanded(nodeId);
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, collapsed: expanded } : n))
      );
    },
    [isNodeExpanded]
  );

  const expandAllNodes = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, collapsed: false })));
  }, []);

  const collapseToChapters = useCallback(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, collapsed: true })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const nodePosition = useCallback(
    (id: string): { x: number; y: number } => {
      if (id === MINDMAP_ROOT_ID) return { x: 0, y: 0 };
      const node = nodesById.get(id);
      return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    },
    [nodesById]
  );

  // 邊的兩端如果都是骨架卡節點，回傳對應的骨架卡 id，否則回傳 null
  const cardIdForEndpoint = useCallback(
    (endpointId: string): string | null => {
      if (endpointId === MINDMAP_ROOT_ID) return null;
      const node = nodesById.get(endpointId);
      if (!node || node.kind !== "card" || !node.cardId) return null;
      return node.cardId;
    },
    [nodesById]
  );

  // 畫布上手動連線的骨架卡節點，同步寫回 relatedCardIds（API 會自動雙向同步）
  const linkRelatedCards = useCallback(
    async (cardAId: string, cardBId: string) => {
      const cardA = cardsById.get(cardAId);
      if (!cardA || cardA.relatedCardIds.includes(cardBId)) return;
      const nextRelated = Array.from(new Set([...cardA.relatedCardIds, cardBId]));
      try {
        const res = await fetch(`/api/skeleton-cards/${cardAId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relatedCardIds: nextRelated }),
        });
        if (!res.ok) return;
        setCards((prev) =>
          prev.map((c) => {
            if (c.id === cardAId) return { ...c, relatedCardIds: nextRelated };
            if (c.id === cardBId)
              return {
                ...c,
                relatedCardIds: Array.from(new Set([...c.relatedCardIds, cardAId])),
              };
            return c;
          })
        );
      } catch {
        // 靜默失敗：畫布連線本身仍然成立，之後在骨架卡編輯頁仍可手動關聯
      }
    },
    [cardsById]
  );

  const unlinkRelatedCards = useCallback(
    async (cardAId: string, cardBId: string) => {
      const cardA = cardsById.get(cardAId);
      if (!cardA || !cardA.relatedCardIds.includes(cardBId)) return;
      const nextRelated = cardA.relatedCardIds.filter((id) => id !== cardBId);
      try {
        const res = await fetch(`/api/skeleton-cards/${cardAId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relatedCardIds: nextRelated }),
        });
        if (!res.ok) return;
        setCards((prev) =>
          prev.map((c) => {
            if (c.id === cardAId) return { ...c, relatedCardIds: nextRelated };
            if (c.id === cardBId)
              return {
                ...c,
                relatedCardIds: c.relatedCardIds.filter((id) => id !== cardAId),
              };
            return c;
          })
        );
      } catch {
        // 靜默失敗即可，不影響畫布上的連線刪除
      }
    },
    [cardsById]
  );

  const removeNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.fromId !== nodeId && e.toId !== nodeId));
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, []);

  const removeEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      setSelectedEdgeId((prev) => (prev === edgeId ? null : prev));
      if (edge) {
        const cardAId = cardIdForEndpoint(edge.fromId);
        const cardBId = cardIdForEndpoint(edge.toId);
        if (cardAId && cardBId && cardAId !== cardBId) {
          void unlinkRelatedCards(cardAId, cardBId);
        }
      }
    },
    [edges, cardIdForEndpoint, unlinkRelatedCards]
  );

  const toggleCardOnCanvas = useCallback(
    (cardId: string) => {
      const existing = nodes.find((n) => n.kind === "card" && n.cardId === cardId);
      if (existing) {
        removeNode(existing.id);
        return;
      }
      const pos = nextSpiralPosition(nodes.length);
      const id = crypto.randomUUID();
      setNodes((prev) => [...prev, { id, kind: "card", cardId, x: pos.x, y: pos.y }]);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
    },
    [nodes, removeNode]
  );

  const addTextNode = useCallback(() => {
    const pos = nextSpiralPosition(nodes.length);
    const id = crypto.randomUUID();
    setNodes((prev) => [
      ...prev,
      { id, kind: "text", label: "新節點", x: pos.x, y: pos.y },
    ]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setEditingNodeId(id);
  }, [nodes.length]);

  const commitTextLabel = useCallback((nodeId: string, label: string) => {
    const trimmed = label.trim() || "新節點";
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, label: trimmed } : n))
    );
  }, []);

  const createEdge = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      setEdges((prev) => {
        const exists = prev.some(
          (e) =>
            (e.fromId === fromId && e.toId === toId) ||
            (e.fromId === toId && e.toId === fromId)
        );
        if (exists) return prev;
        return [...prev, { id: crypto.randomUUID(), fromId, toId }];
      });
      const cardAId = cardIdForEndpoint(fromId);
      const cardBId = cardIdForEndpoint(toId);
      if (cardAId && cardBId && cardAId !== cardBId) {
        void linkRelatedCards(cardAId, cardBId);
      }
    },
    [cardIdForEndpoint, linkRelatedCards]
  );

  const handleNodeInteraction = useCallback(
    (nodeId: string) => {
      if (connectMode) {
        if (connectFromId === null) {
          setConnectFromId(nodeId);
        } else if (connectFromId === nodeId) {
          setConnectFromId(null);
        } else {
          createEdge(connectFromId, nodeId);
          setConnectFromId(null);
        }
        return;
      }
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    },
    [connectMode, connectFromId, createEdge]
  );

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const ratio = VIEWBOX_SIZE / Math.min(rect.width, rect.height);
      const node = nodesById.get(nodeId);
      if (!node) return;
      // 連接模式下仍要記錄 mousedown，讓 mouseup 判斷「沒有拖曳」時能觸發選取節點連線；
      // 但拖曳位移在 handleMove 會依 connectMode 略過，避免誤移動節點
      dragRef.current = {
        nodeId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: node.x,
        startY: node.y,
        ratio,
        moved: false,
      };
    },
    [nodesById]
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      if (connectMode) return;
      const nextX = drag.startX + dx * drag.ratio;
      const nextY = drag.startY + dy * drag.ratio;
      setNodes((prev) =>
        prev.map((n) => (n.id === drag.nodeId ? { ...n, x: nextX, y: nextY } : n))
      );
    };
    const handleUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) handleNodeInteraction(drag.nodeId);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [handleNodeInteraction, connectMode]);

  // Delete/Backspace 刪除目前選取的節點或連線（輸入框聚焦時不觸發）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement as HTMLElement | null;
      const isEditable =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (isEditable) return;
      if (selectedNodeId) removeNode(selectedNodeId);
      else if (selectedEdgeId) removeEdge(selectedEdgeId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeId, selectedEdgeId, removeNode, removeEdge]);

  const resetView = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setScale((prev) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * (e.deltaY > 0 ? 0.9 : 1.1)))
    );
  }, []);

  const onPanMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    panDragRef.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onPanMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!panning) return;
      const dx = e.clientX - panDragRef.current.x;
      const dy = e.clientY - panDragRef.current.y;
      panDragRef.current = { x: e.clientX, y: e.clientY };
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [panning]
  );

  const endPan = useCallback(() => setPanning(false), []);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setClearConfirmOpen(false);
  }, []);

  const dimmedNodeIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set<string>();
    const dimmed = new Set<string>();
    for (const node of nodes) {
      let text = "";
      if (node.kind === "card") {
        const card = node.cardId ? cardsById.get(node.cardId) : undefined;
        text = card
          ? [card.topic, card.topicEn, ...card.keywordDisplay].join(" ")
          : "";
      } else {
        text = node.label ?? "";
      }
      if (!text.toLowerCase().includes(q)) dimmed.add(node.id);
    }
    return dimmed;
  }, [search, nodes, cardsById]);

  const filteredPickerCards = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.topic, c.topicEn, ...c.keywordDisplay].join(" ").toLowerCase().includes(q)
    );
  }, [cards, pickerSearch]);

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null;
  const selectedCard =
    selectedNode?.kind === "card" && selectedNode.cardId
      ? cardsById.get(selectedNode.cardId) ?? null
      : null;
  const selectedEdge = selectedEdgeId
    ? edges.find((e) => e.id === selectedEdgeId) ?? null
    : null;

  return (
    <div className="flex h-full w-full flex-col px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-stone-500">自己蓋的架構圖</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-stone-900">
            骨架心智圖
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
            以科目為中心，畫布預設是空的：自己挑要放的骨架卡、加文字節點、手動拉線。拖曳節點調整位置，選取後可用 Delete 刪除。
          </p>
        </div>
        <Link
          href="/skeleton-cards"
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          ← 回骨架卡列表
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
          {PRESET_SUBJECTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSubject(s)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                subject === s
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen((prev) => !prev)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          {pickerOpen ? "關閉挑選骨架卡" : "+ 加入骨架卡"}
        </button>
        <button
          type="button"
          onClick={addTextNode}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
        >
          + 文字節點
        </button>
        <button
          type="button"
          onClick={() => {
            setConnectMode((prev) => !prev);
            setConnectFromId(null);
          }}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            connectMode
              ? "border-violet-400 bg-violet-100 text-violet-800"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
          }`}
        >
          {connectMode ? "連接模式（點兩個節點拉線）" : "連接模式"}
        </button>
        <button
          type="button"
          onClick={() => setClearConfirmOpen(true)}
          disabled={nodes.length === 0}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          清空畫布
        </button>
        <button
          type="button"
          onClick={expandAllNodes}
          disabled={nodes.length === 0}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          全部展開
        </button>
        <button
          type="button"
          onClick={collapseToChapters}
          disabled={nodes.length === 0}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
        >
          只看第一層
        </button>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋畫布上的節點"
          className="w-48 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
        />
        <span className="text-xs text-stone-500">
          {saveStatus === "saving" ? "儲存中…" : saveStatus === "saved" ? "已自動儲存" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.15))}
            className="h-8 w-8 rounded-lg border border-stone-300 bg-white text-sm font-medium text-stone-700 hover:bg-stone-50"
            aria-label="放大"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s * 0.87))}
            className="h-8 w-8 rounded-lg border border-stone-300 bg-white text-sm font-medium text-stone-700 hover:bg-stone-50"
            aria-label="縮小"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            重置視角
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="relative mt-4">
        <div
          className="relative h-[440px] overflow-hidden rounded-2xl border border-stone-200 bg-[#fffdf8]"
          onWheel={onWheel}
          onMouseDown={onPanMouseDown}
          onMouseMove={onPanMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          style={{ cursor: panning ? "grabbing" : connectMode ? "crosshair" : "grab" }}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-500">
              載入中…
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${-VIEWBOX_HALF} ${-VIEWBOX_HALF} ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
              className="h-full w-full select-none"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: "center center",
                transition: panning ? "none" : "transform 80ms linear",
              }}
            >
              {visibleEdges.map((edge) => {
                const from = nodePosition(edge.fromId);
                const to = nodePosition(edge.toId);
                const midX = (from.x + to.x) / 2;
                const midY = (from.y + to.y) / 2;
                const selected = selectedEdgeId === edge.id;
                const cardAId = cardIdForEndpoint(edge.fromId);
                const cardBId = cardIdForEndpoint(edge.toId);
                const isCardLink = Boolean(cardAId && cardBId && cardAId !== cardBId);
                return (
                  <g key={edge.id} className="group">
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="transparent"
                      strokeWidth={14}
                      style={{ cursor: connectMode ? "default" : "pointer" }}
                      onClick={(e) => {
                        if (connectMode) return;
                        e.stopPropagation();
                        setSelectedEdgeId(edge.id);
                        setSelectedNodeId(null);
                      }}
                    />
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={selected ? "#78350f" : isCardLink ? "#a78bfa" : "#a8a29e"}
                      strokeWidth={selected ? 2.5 : 1.5}
                    />
                    {edge.label && (
                      <text
                        x={midX}
                        y={midY - 4}
                        textAnchor="middle"
                        className="text-[10px]"
                        fill="#78716c"
                      >
                        {edge.label}
                      </text>
                    )}
                    <circle
                      cx={midX}
                      cy={midY}
                      r={7}
                      fill="#fff"
                      stroke="#dc2626"
                      strokeWidth={1.2}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeEdge(edge.id);
                      }}
                    />
                    <text
                      x={midX}
                      y={midY + 3}
                      textAnchor="middle"
                      className="pointer-events-none select-none text-[9px] opacity-0 transition-opacity group-hover:opacity-100"
                      fill="#dc2626"
                    >
                      ×
                    </text>
                  </g>
                );
              })}

              {/* 科目中心：牌匾造型（圓角矩形），跟卡片/文字節點的圓形／方形做出區隔 */}
              <g
                onClick={(e) => {
                  e.stopPropagation();
                  if (connectMode) handleNodeInteraction(MINDMAP_ROOT_ID);
                }}
                style={{ cursor: connectMode ? "crosshair" : "default" }}
              >
                <rect
                  x={-64}
                  y={-22}
                  width={128}
                  height={44}
                  rx={10}
                  fill="#1c1917"
                  stroke={connectFromId === MINDMAP_ROOT_ID ? "#a78bfa" : "#1c1917"}
                  strokeWidth={connectFromId === MINDMAP_ROOT_ID ? 3 : 1.5}
                />
                <text
                  x={0}
                  y={5}
                  textAnchor="middle"
                  className="font-serif text-[15px] font-semibold"
                  fill="#fafaf9"
                >
                  {subject}
                </text>
              </g>

              {visibleNodes.map((node) => {
                const dimmed = dimmedNodeIds.has(node.id);
                const selected = selectedNodeId === node.id;
                const connecting = connectFromId === node.id;
                const strokeColor = connecting
                  ? "#a78bfa"
                  : selected
                    ? "#78350f"
                    : undefined;
                const childIds = treeInfo.childrenOf.get(node.id) ?? [];
                const hasChildren = childIds.length > 0;
                const expanded = isNodeExpanded(node.id);
                const toggleBadge = (cx: number, cy: number) =>
                  hasChildren && (
                    <g
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={7}
                        fill={expanded ? "#f5f5f4" : "#44403c"}
                        stroke="#78716c"
                        strokeWidth={1}
                      />
                      <text
                        x={cx}
                        y={cy + 3}
                        textAnchor="middle"
                        className="pointer-events-none select-none text-[10px] font-bold"
                        fill={expanded ? "#57534e" : "#fafaf9"}
                      >
                        {expanded ? "−" : "+"}
                      </text>
                    </g>
                  );
                if (node.kind === "card") {
                  const card = node.cardId ? cardsById.get(node.cardId) : undefined;
                  const label = card ? card.topic : "（已刪除的骨架卡）";
                  const fill = !card
                    ? "#f5f5f4"
                    : card.isStub
                      ? "#e0f2fe"
                      : "#d1fae5";
                  const defaultStroke = !card
                    ? "#d6d3d1"
                    : card.isStub
                      ? "#0284c7"
                      : "#059669";
                  return (
                    <g
                      key={node.id}
                      opacity={dimmed ? 0.2 : 1}
                      className="group"
                      style={{ cursor: connectMode ? "crosshair" : "grab" }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={14}
                        fill={fill}
                        stroke={strokeColor ?? defaultStroke}
                        strokeWidth={selected || connecting ? 2.5 : 1.5}
                      />
                      <text
                        x={node.x}
                        y={node.y - 20}
                        textAnchor="middle"
                        className="text-[12px] font-medium"
                        fill="#292524"
                      >
                        {label.length > 14 ? `${label.slice(0, 14)}…` : label}
                      </text>
                      <circle
                        cx={node.x + 16}
                        cy={node.y - 16}
                        r={7}
                        fill="#fff"
                        stroke="#dc2626"
                        strokeWidth={1.2}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNode(node.id);
                        }}
                      />
                      <text
                        x={node.x + 16}
                        y={node.y - 13}
                        textAnchor="middle"
                        className="pointer-events-none select-none text-[9px] opacity-0 transition-opacity group-hover:opacity-100"
                        fill="#dc2626"
                      >
                        ×
                      </text>
                      {toggleBadge(node.x - 16, node.y - 16)}
                    </g>
                  );
                }

                const label = node.label ?? "";
                const width = textNodeWidth(label);
                if (editingNodeId === node.id) {
                  return (
                    <foreignObject
                      key={node.id}
                      x={node.x - width / 2}
                      y={node.y - 13}
                      width={width}
                      height={26}
                    >
                      <input
                        autoFocus
                        defaultValue={label}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          commitTextLabel(node.id, e.currentTarget.value);
                          setEditingNodeId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingNodeId(null);
                        }}
                        className="h-full w-full rounded-md border border-amber-400 bg-white px-1.5 text-[11px] text-stone-900 outline-none"
                      />
                    </foreignObject>
                  );
                }
                return (
                  <g
                    key={node.id}
                    opacity={dimmed ? 0.2 : 1}
                    className="group"
                    style={{ cursor: connectMode ? "crosshair" : "grab" }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!connectMode) setEditingNodeId(node.id);
                    }}
                  >
                    <rect
                      x={node.x - width / 2}
                      y={node.y - 13}
                      width={width}
                      height={26}
                      rx={8}
                      fill="#fef3c7"
                      stroke={strokeColor ?? "#d6d3d1"}
                      strokeWidth={selected || connecting ? 2.5 : 1.5}
                    />
                    <text
                      x={node.x}
                      y={node.y + 4}
                      textAnchor="middle"
                      className="text-[11px]"
                      fill="#78350f"
                    >
                      {label.length > 18 ? `${label.slice(0, 18)}…` : label}
                    </text>
                    <circle
                      cx={node.x + width / 2 + 2}
                      cy={node.y - 13}
                      r={7}
                      fill="#fff"
                      stroke="#dc2626"
                      strokeWidth={1.2}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNode(node.id);
                      }}
                    />
                    <text
                      x={node.x + width / 2 + 2}
                      y={node.y - 10}
                      textAnchor="middle"
                      className="pointer-events-none select-none text-[9px] opacity-0 transition-opacity group-hover:opacity-100"
                      fill="#dc2626"
                    >
                      ×
                    </text>
                    {toggleBadge(node.x - width / 2 - 2, node.y - 13)}
                  </g>
                );
              })}
            </svg>
          )}

          {!loading && nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-stone-400">
                畫布是空的：用上面「+ 加入骨架卡」或「+ 文字節點」開始蓋
              </p>
            </div>
          )}

          {(selectedCard || selectedNode?.kind === "text" || selectedEdge) && (
            <div className="pointer-events-none absolute right-4 top-4 w-72 max-w-[80vw]">
              <div className="pointer-events-auto max-h-[calc(100%-2rem)] overflow-y-auto">
                {selectedCard ? (
            <div className="flex-1 overflow-y-auto rounded-2xl border border-stone-200 bg-[#fffdf8] p-4">
              <p className="text-xs font-medium text-stone-500">
                {selectedCard.subject}
                {selectedCard.isStub ? "・卡樁" : "・完整"}
              </p>
              <p className="mt-1 text-sm font-semibold text-stone-900">
                {selectedCard.topic}
                {selectedCard.topicEn && (
                  <span className="ml-1.5 font-normal text-stone-500">
                    {selectedCard.topicEn}
                  </span>
                )}
              </p>
              {selectedCard.keywordDisplay.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedCard.keywordDisplay.map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600"
                    >
                      #{k}
                    </span>
                  ))}
                </div>
              )}
              {selectedCard.definition && (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-stone-700">
                  {selectedCard.definition}
                </p>
              )}
              {selectedCard.blocks.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {selectedCard.blocks.map((b) => (
                    <li key={b.label} className="text-xs text-stone-600">
                      <span className="font-medium text-stone-800">{b.label}</span>
                      （{b.points.length}/{b.count}）：
                      {b.points.map((p) => p.key).filter(Boolean).join("、") ||
                        "尚未展開"}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/skeleton-cards/${selectedCard.id}`}
                  className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  編輯這張骨架卡 →
                </Link>
                <button
                  type="button"
                  onClick={() => selectedNode && removeNode(selectedNode.id)}
                  className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  從畫布移除
                </button>
              </div>
            </div>
          ) : selectedNode?.kind === "text" ? (
            <div className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4">
              <p className="text-xs font-medium text-stone-500">文字節點</p>
              <textarea
                value={selectedNode.label ?? ""}
                onChange={(e) => commitTextLabel(selectedNode.id, e.target.value)}
                rows={3}
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
              />
              <button
                type="button"
                onClick={() => removeNode(selectedNode.id)}
                className="mt-2 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                刪除節點
              </button>
            </div>
          ) : selectedEdge ? (
            <div className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4">
              <p className="text-xs font-medium text-stone-500">連線</p>
              <label className="mt-2 block text-xs text-stone-600">
                標籤（選填）
                <input
                  type="text"
                  value={selectedEdge.label ?? ""}
                  onChange={(e) =>
                    setEdges((prev) =>
                      prev.map((edge) =>
                        edge.id === selectedEdge.id
                          ? { ...edge, label: e.target.value }
                          : edge
                      )
                    )
                  }
                  placeholder="例如：共用加密模組"
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none ring-stone-400 focus:ring-2"
                />
              </label>
              <button
                type="button"
                onClick={() => removeEdge(selectedEdge.id)}
                className="mt-2 rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                刪除連線
              </button>
            </div>
          ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-[#fffdf8] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-700">
              {subject}・勾選要放進畫布的骨架卡
            </p>
            <input
              type="text"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="搜尋主題／關鍵字"
              className="w-48 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-900 outline-none ring-stone-400 focus:ring-2"
            />
          </div>
          <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {filteredPickerCards.length === 0 ? (
              <p className="text-xs text-stone-500">沒有符合的骨架卡</p>
            ) : (
              filteredPickerCards.map((card) => (
                <label
                  key={card.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
                >
                  <input
                    type="checkbox"
                    checked={canvasCardIds.has(card.id)}
                    onChange={() => toggleCardOnCanvas(card.id)}
                    className="h-3.5 w-3.5 accent-stone-700"
                  />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      card.isStub
                        ? "bg-sky-100 text-sky-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {card.isStub ? "卡樁" : "完整"}
                  </span>
                  <span>{card.topic}</span>
                  {card.topicEn && (
                    <span className="text-stone-400">{card.topicEn}</span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-xs text-stone-600">
        <p className="font-medium text-stone-700">操作說明</p>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 leading-relaxed">
          <li>拖曳節點可調整位置；拖曳空白處平移畫布</li>
          <li>雙擊文字節點可改內容</li>
          <li>開「連接模式」後依序點兩個節點畫線，再點一次同一節點可取消</li>
          <li>滑鼠移到節點／連線上會出現紅色 × 可直接刪除</li>
          <li>選取節點或連線後按 Delete／Backspace 也可刪除</li>
          <li>兩張骨架卡節點連線（紫色）會同步設成關聯骨架卡，刪除連線也會取消關聯</li>
          <li>有子節點的節點左側會有 +／− 圓點，點一下收合／展開下一層；第二層以下預設收合，避免節點太多卡頓</li>
          <li>搜尋時會暫時無視收合狀態，找得到所有節點；「全部展開」「只看第一層」可快速切換</li>
        </ul>
      </div>

      <ConfirmDeleteDialog
        open={clearConfirmOpen}
        title="清空畫布"
        description="這會移除目前科目畫布上的所有節點與連線（骨架卡本身不會被刪除），確定要清空嗎？"
        confirmLabel="清空"
        busy={false}
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={clearCanvas}
      />
    </div>
  );
}

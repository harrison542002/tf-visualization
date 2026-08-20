"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useMemo, useState, type DragEvent, type MouseEvent } from "react";

import { useGraphStore, type ResourceNode } from "@/lib/graph/store";
import { useThemeStore } from "@/lib/theme/store";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { RESOURCE_DRAG_TYPE } from "./Palette";
import { ResourceNode as ResourceNodeComponent } from "./ResourceNode";
import { ResourceSearch } from "./ResourceSearch";
import { useExportPng } from "./useExportPng";

import "@xyflow/react/dist/style.css";

/** Defined outside the component so React Flow does not see a new object each render. */
const nodeTypes: NodeTypes = { resource: ResourceNodeComponent };

type MenuTarget =
  | { readonly kind: "pane" }
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "edge"; readonly id: string };

interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly target: MenuTarget;
}

export function Canvas() {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const onNodesChange = useGraphStore((state) => state.onNodesChange);
  const onEdgesChange = useGraphStore((state) => state.onEdgesChange);
  const onConnect = useGraphStore((state) => state.onConnect);
  const isValidConnection = useGraphStore((state) => state.isValidConnection);
  const addResource = useGraphStore((state) => state.addResource);
  const selectNode = useGraphStore((state) => state.selectNode);
  const duplicateNode = useGraphStore((state) => state.duplicateNode);
  const removeNode = useGraphStore((state) => state.removeNode);
  const removeEdge = useGraphStore((state) => state.removeEdge);
  const clearGraph = useGraphStore((state) => state.clearGraph);
  const autoLayout = useGraphStore((state) => state.autoLayout);
  const checkpoint = useGraphStore((state) => state.checkpoint);

  const theme = useThemeStore((state) => state.resolved);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { exportPng } = useExportPng();
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** Flow coordinates the search should drop its result at, or null when it is closed. */
  const [searchAt, setSearchAt] = useState<XYPosition | null>(null);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const resourceType = event.dataTransfer.getData(RESOURCE_DRAG_TYPE);
      if (!resourceType) return;

      // Drop coordinates are in screen space; the canvas may be panned or zoomed.
      // The node appears once its schema has loaded; the palette shows progress meanwhile.
      void addResource(
        resourceType,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [addResource, screenToFlowPosition],
  );

  const openMenu = useCallback((event: MouseEvent, target: MenuTarget) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, target });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useMemo((): readonly ContextMenuItem[] => {
    if (!menu) return [];

    switch (menu.target.kind) {
      case "node": {
        const nodeId = menu.target.id;
        return [
          { label: "Duplicate", onSelect: () => duplicateNode(nodeId) },
          { label: "Delete", onSelect: () => removeNode(nodeId), destructive: true },
        ];
      }
      case "edge": {
        const edgeId = menu.target.id;
        return [
          { label: "Delete connection", onSelect: () => removeEdge(edgeId), destructive: true },
        ];
      }
      case "pane": {
        // Captured now: the menu closes on select, and with it the click position.
        const at = screenToFlowPosition({ x: menu.x, y: menu.y });
        return [
          { label: "Add resource…", onSelect: () => setSearchAt(at) },
          {
            label: "Tidy layout",
            onSelect: autoLayout,
            separated: true,
            disabled: nodes.length === 0,
          },
          { label: "Fit to view", onSelect: () => void fitView({ duration: 200 }) },
          { label: "Export as PNG", onSelect: exportPng, disabled: nodes.length === 0 },
          {
            label: "Clear canvas",
            onSelect: clearGraph,
            destructive: true,
            separated: true,
            disabled: nodes.length === 0,
          },
        ];
      }
    }
  }, [
    menu,
    duplicateNode,
    removeNode,
    removeEdge,
    autoLayout,
    fitView,
    exportPng,
    clearGraph,
    screenToFlowPosition,
    nodes.length,
  ]);

  // React Flow mutates neither array, but its props are not readonly.
  const flowNodes = useMemo(() => [...nodes], [nodes]);
  const flowEdges = useMemo(() => [...edges], [edges]);

  return (
    <div className="h-full flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        // One checkpoint per drag, taken before anything moves, so undo restores the whole
        // gesture rather than one frame of it.
        onNodeDragStart={() => checkpoint()}
        onNodeContextMenu={(event: MouseEvent, node: ResourceNode) =>
          openMenu(event, { kind: "node", id: node.id })
        }
        onEdgeContextMenu={(event: MouseEvent, edge: Edge) =>
          openMenu(event, { kind: "edge", id: edge.id })
        }
        onPaneContextMenu={(event) => openMenu(event as MouseEvent, { kind: "pane" })}
        fitView
        deleteKeyCode={["Backspace", "Delete"]}
        // React Flow's own chrome defaults to light. Driven from our store rather than its
        // "system" setting so an explicit light/dark choice applies to the canvas too.
        colorMode={theme}
      >
        <Background />
        <Controls />
        <MiniMap
          pannable
          zoomable
          className="!bottom-3 !right-3 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      </ReactFlow>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}

      {searchAt && (
        <ResourceSearch
          onSelect={(resourceType) => void addResource(resourceType, searchAt)}
          onClose={() => setSearchAt(null)}
        />
      )}
    </div>
  );
}

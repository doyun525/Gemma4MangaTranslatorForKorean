import React from "react";
import type { BBox, InpaintingMaskStroke, MangaPage, TranslationBlock } from "../../../shared/types";
import { resolveBlockRectPx, type PixelRect, type ViewportSize } from "../lib/overlayLayout";
import { OverlayBlock } from "./OverlayBlock";

export type ImageStageProps = {
  page: MangaPage;
  imageDataUrl: string;
  imageRef: React.RefObject<HTMLImageElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  stageSize: ViewportSize | null;
  selectedBlockId: string | null;
  showTextBlocks: boolean;
  showBlockChrome: boolean;
  inpaintingMode?: boolean;
  blockPointerDisabled?: boolean;
  retouchCursor?: {
    point: { x: number; y: number } | null;
    radiusPx: number;
    mode: "brush" | "eraser" | "mask";
    color: string;
  } | null;
  retouchPreview?: {
    mode: "brush" | "eraser" | "mask";
    points: Array<{ x: number; y: number }>;
    radiusPx: number;
    color: string;
    originalImageDataUrl: string;
  } | null;
  maskStrokes?: InpaintingMaskStroke[];
  regionSelectionActive: boolean;
  regionSelectionRect: BBox | null;
  fileDropActive?: boolean;
  onStagePointerMove: (event: React.PointerEvent) => void;
  onStagePointerUp: (event: React.PointerEvent) => void;
  onStagePointerDown: (event: React.PointerEvent) => void;
  onStagePointerLeave?: (event: React.PointerEvent) => void;
  onBlockPointerDown: (event: React.PointerEvent, block: TranslationBlock, mode: "move" | "resize") => void;
  onToggleBlockExcluded?: (blockId: string) => void;
};

export function ImageStage({
  page,
  imageDataUrl,
  imageRef,
  stageRef,
  stageSize,
  selectedBlockId,
  showTextBlocks,
  showBlockChrome,
  inpaintingMode = false,
  blockPointerDisabled = false,
  retouchCursor = null,
  retouchPreview = null,
  maskStrokes = [],
  regionSelectionActive,
  regionSelectionRect,
  fileDropActive = false,
  onStagePointerMove,
  onStagePointerUp,
  onStagePointerDown,
  onStagePointerLeave,
  onBlockPointerDown,
  onToggleBlockExcluded
}: ImageStageProps): React.JSX.Element {
  const clipId = React.useId();
  const visibleStageRect = useVisibleStageRect(stageRef, stageSize, `${page.id}:${page.width}x${page.height}:${page.blocks.length}`);
  const cursorVisible = Boolean(retouchCursor?.point && stageSize);
  const cursorScaleX = stageSize ? stageSize.width / Math.max(1, page.width) : 1;
  const cursorScaleY = stageSize ? stageSize.height / Math.max(1, page.height) : 1;
  const cursorRadius = retouchCursor ? Math.max(3, retouchCursor.radiusPx * Math.min(cursorScaleX, cursorScaleY)) : 0;
  const previewPath = retouchPreview?.points.length ? pointsToPath(retouchPreview.points) : "";
  const previewStrokeWidth = retouchPreview ? Math.max(1, retouchPreview.radiusPx * 2) : 0;
  const maskStrokePaths = maskStrokes
    .map((stroke) => ({
      path: pointsToPath(stroke.points),
      width: Math.max(1, stroke.radiusPx * 2)
    }))
    .filter((stroke) => stroke.path);
  const pageSize = React.useMemo(() => ({ width: page.width, height: page.height }), [page.height, page.width]);
  const shouldVirtualizeBlocks = Boolean(
    stageSize &&
      visibleStageRect &&
      showTextBlocks &&
      !inpaintingMode &&
      page.blocks.length > 320
  );
  const visibleBlocks = React.useMemo(() => {
    if (!stageSize || !shouldVirtualizeBlocks || !visibleStageRect) {
      return page.blocks;
    }
    const padding = Math.max(800, visibleStageRect.height * 1.5);
    const paddedRect: PixelRect = {
      left: visibleStageRect.left - 200,
      top: visibleStageRect.top - padding,
      width: visibleStageRect.width + 400,
      height: visibleStageRect.height + padding * 2
    };
    return page.blocks.filter((block) => {
      if (block.id === selectedBlockId) {
        return true;
      }
      if (block.renderDirection === "hidden") {
        return false;
      }
      const text = block.translatedText || block.sourceText || "";
      const rect = resolveBlockRectPx(block, pageSize, stageSize, text);
      return rectsIntersect(rect, paddedRect);
    });
  }, [page.blocks, pageSize, selectedBlockId, shouldVirtualizeBlocks, stageSize, visibleStageRect]);

  return (
    <div className="stage-wrap">
      <div
        ref={stageRef}
        className={[
          "image-stage",
          regionSelectionActive ? "selecting-region" : "",
          blockPointerDisabled ? "editing-mask" : "",
          retouchCursor ? "retouch-tool-enabled" : "",
          cursorVisible ? "retouch-cursor-active" : "",
          fileDropActive ? "file-drop-active" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
        onPointerLeave={onStagePointerLeave}
        onPointerDown={onStagePointerDown}
      >
        {imageDataUrl ? (
          <img ref={imageRef} className="page-image" src={imageDataUrl} alt={page.name} draggable={false} />
        ) : (
          <div className="page-image-placeholder" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
            이미지 불러오는 중
          </div>
        )}
        {imageDataUrl && stageSize && showTextBlocks
          ? visibleBlocks.map((block) => (
              <OverlayBlock
                key={block.id}
                block={block}
                pageSize={pageSize}
                stageSize={stageSize}
                selected={block.id === selectedBlockId}
                showChrome={showBlockChrome}
                showExcluded={inpaintingMode}
                pointerDisabled={blockPointerDisabled}
                onPointerDown={(event) => onBlockPointerDown(event, block, "move")}
                onResizePointerDown={(event) => onBlockPointerDown(event, block, "resize")}
                onToggleExcluded={onToggleBlockExcluded ? () => onToggleBlockExcluded(block.id) : undefined}
              />
            ))
          : null}
        {imageDataUrl && stageSize && maskStrokePaths.length > 0 ? (
          <svg
            className="retouch-preview-layer retouch-preview-mask retouch-preview-committed-mask"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {maskStrokePaths.map((stroke, index) => (
              <path key={index} d={stroke.path} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            ))}
          </svg>
        ) : null}
        {imageDataUrl && stageSize && retouchPreview && previewPath ? (
          <svg
            className={`retouch-preview-layer retouch-preview-${retouchPreview.mode}`}
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {retouchPreview.mode === "eraser" && retouchPreview.originalImageDataUrl ? (
              <>
                <defs>
                  <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                    <path d={previewPath} stroke="#fff" strokeWidth={previewStrokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </clipPath>
                </defs>
                <image href={retouchPreview.originalImageDataUrl} x="0" y="0" width={page.width} height={page.height} clipPath={`url(#${clipId})`} />
                <path className="retouch-preview-outline" d={previewPath} strokeWidth={previewStrokeWidth} />
              </>
            ) : (
              <path d={previewPath} stroke={retouchPreview.color} strokeWidth={previewStrokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            )}
          </svg>
        ) : null}
        {cursorVisible && retouchCursor?.point && stageSize ? (
          <div
            className={`retouch-cursor retouch-cursor-${retouchCursor.mode}`}
            style={{
              left: `${retouchCursor.point.x * cursorScaleX}px`,
              top: `${retouchCursor.point.y * cursorScaleY}px`,
              width: `${cursorRadius * 2}px`,
              height: `${cursorRadius * 2}px`,
              marginLeft: `${-cursorRadius}px`,
              marginTop: `${-cursorRadius}px`,
              "--retouch-cursor-color": retouchCursor.color
            } as React.CSSProperties}
          >
            <span />
          </div>
        ) : null}
        {imageDataUrl && stageSize && regionSelectionActive && regionSelectionRect ? (
          <div
            className="region-selection-box"
            style={{
              left: `${(regionSelectionRect.x / 1000) * stageSize.width}px`,
              top: `${(regionSelectionRect.y / 1000) * stageSize.height}px`,
              width: `${(regionSelectionRect.w / 1000) * stageSize.width}px`,
              height: `${(regionSelectionRect.h / 1000) * stageSize.height}px`
            }}
          />
        ) : null}
        {fileDropActive ? <div className="stage-drop-overlay">파일을 놓아 가져오기</div> : null}
      </div>
    </div>
  );
}

function useVisibleStageRect(
  stageRef: React.RefObject<HTMLDivElement | null>,
  stageSize: ViewportSize | null,
  revision: string
): PixelRect | null {
  const [rect, setRect] = React.useState<PixelRect | null>(null);

  React.useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !stageSize) {
      setRect(null);
      return;
    }

    let frame = 0;
    const scrollContainer = findScrollContainer(stage);
    const sync = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        const stageRect = stage.getBoundingClientRect();
        const viewportRect = scrollContainer
          ? scrollContainer.getBoundingClientRect()
          : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const nextRect = {
          left: Math.max(0, viewportRect.left - stageRect.left),
          top: Math.max(0, viewportRect.top - stageRect.top),
          width: Math.max(1, Math.min(stageRect.width, viewportRect.width)),
          height: Math.max(1, Math.min(stageRect.height, viewportRect.height))
        };
        setRect((current) => {
          if (
            current &&
            Math.abs(current.left - nextRect.left) < 1 &&
            Math.abs(current.top - nextRect.top) < 1 &&
            Math.abs(current.width - nextRect.width) < 1 &&
            Math.abs(current.height - nextRect.height) < 1
          ) {
            return current;
          }
          return nextRect;
        });
      });
    };

    sync();
    scrollContainer?.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    if (scrollContainer) {
      observer.observe(scrollContainer);
    }
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      scrollContainer?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      observer.disconnect();
    };
  }, [revision, stageRef, stageSize?.height, stageSize?.width]);

  return rect;
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY || style.overflow;
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 2) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function rectsIntersect(a: PixelRect, b: PixelRect): boolean {
  return a.left + a.width >= b.left && b.left + b.width >= a.left && a.top + a.height >= b.top && b.top + b.height >= a.top;
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} L ${point.x + 0.01} ${point.y}`;
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

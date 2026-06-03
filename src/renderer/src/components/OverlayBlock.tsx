import React from "react";
import type { TranslationBlock } from "../../../shared/types";
import { resolveOverlayBlockBackground, resolveOverlayBlockRenderModel, type ViewportSize } from "../lib/blockRenderModel";

type OverlayBlockProps = {
  block: TranslationBlock;
  pageSize: ViewportSize;
  stageSize: ViewportSize;
  selected: boolean;
  showChrome: boolean;
  showExcluded?: boolean;
  pointerDisabled?: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onResizePointerDown: (event: React.PointerEvent) => void;
  onToggleExcluded?: () => void;
};

export function OverlayBlock({
  block,
  pageSize,
  stageSize,
  selected,
  showChrome,
  showExcluded = false,
  pointerDisabled = false,
  onPointerDown,
  onResizePointerDown,
  onToggleExcluded
}: OverlayBlockProps): React.JSX.Element | null {
  if (block.renderDirection === "hidden") {
    return null;
  }

  const model = resolveOverlayBlockRenderModel(block, pageSize, stageSize);
  const { displayText, layout, outlineWidthPx, outlineColor } = model;
  const style: React.CSSProperties = {
    left: layout.rect.left,
    top: layout.rect.top,
    width: layout.rect.width,
    height: layout.rect.height,
    boxSizing: "border-box",
    padding: layout.paddingPx,
    overflow: "visible",
    color: block.textColor,
    border: "none",
    backgroundColor: resolveOverlayBlockBackground(block, model, showChrome),
    fontFamily: model.fontFamily,
    fontSize: `${layout.fontSizePx}px`,
    lineHeight: block.lineHeight,
    textAlign: block.textAlign,
    transform: block.rotationDeg ? `rotate(${block.rotationDeg}deg)` : undefined,
    transformOrigin: "center center",
    pointerEvents: pointerDisabled ? "none" : undefined
  };
  const textWrapStyle: React.CSSProperties = {
    boxSizing: "border-box",
    width: layout.innerWidth,
    maxWidth: "100%",
    height: layout.innerHeight,
    maxHeight: "100%",
    justifyContent: "center",
    overflow: "visible"
  };
  const textStackStyle: React.CSSProperties = {
    display: "grid",
    placeItems: "center",
    width: block.renderDirection === "vertical" ? "max-content" : `${layout.fitInnerWidth}px`,
    height: block.renderDirection === "vertical" ? `${layout.fitInnerHeight}px` : undefined,
    maxWidth: "100%",
    maxHeight: "100%",
    overflow: "visible"
  };
  const contentStyle: React.CSSProperties = {
    boxSizing: "border-box",
    gridArea: "1 / 1",
    writingMode: block.renderDirection === "vertical" ? "vertical-rl" : "horizontal-tb",
    textOrientation: block.renderDirection === "vertical" ? "upright" : undefined,
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    overflow: "visible",
    fontWeight: block.bold ? 800 : 400,
    fontStyle: block.italic ? "italic" : "normal",
    fontSynthesis: "weight style",
    color: block.textColor
  };
  const outlineStyle: React.CSSProperties =
    outlineWidthPx > 0
      ? {
          ...contentStyle,
          zIndex: 0,
          color: "transparent",
          WebkitTextStroke: `${outlineWidthPx}px ${outlineColor}`,
          paintOrder: "stroke",
          pointerEvents: "none"
        }
      : {};
  const fillStyle: React.CSSProperties = {
    ...contentStyle,
    zIndex: 1,
    WebkitTextStroke: "0 transparent"
  };

  const excluded = showExcluded && Boolean(block.inpaintExcluded);

  return (
    <div
      className={[
        "overlay-block",
        `block-${block.type}`,
        selected ? "selected" : "",
        excluded ? "excluded" : "",
        showChrome ? "chrome-visible" : "chrome-hidden"
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerDown={pointerDisabled ? undefined : onPointerDown}
    >
      <div className="overlay-text" style={textWrapStyle}>
        <span className="overlay-text-stack" style={textStackStyle}>
          {outlineWidthPx > 0 ? (
            <span className="overlay-text-content overlay-text-outline" style={outlineStyle} aria-hidden="true">
              {displayText}
            </span>
          ) : null}
          <span className="overlay-text-content overlay-text-fill" style={fillStyle}>
            {displayText}
          </span>
        </span>
      </div>
      {showExcluded && onToggleExcluded && !pointerDisabled ? (
        <button
          type="button"
          className={`overlay-exclude-toggle ${block.inpaintExcluded ? "excluded" : ""}`}
          title={block.inpaintExcluded ? "인페인팅에 다시 포함" : "인페인팅에서 제외"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleExcluded();
          }}
        >
          {block.inpaintExcluded ? "제외됨" : "제외"}
        </button>
      ) : excluded ? (
        <span className="overlay-excluded-badge" aria-hidden="true">제외</span>
      ) : null}
      {selected && !pointerDisabled ? <button className="resize-handle" onPointerDown={onResizePointerDown} aria-label="Resize" /> : null}
    </div>
  );
}

import React from "react";
import type { JobState, MangaPage } from "../../../shared/types";
import type { ProgressSnapshot } from "../lib/jobProgress";
import { ImageStage, type ImageStageProps } from "./ImageStage";
import { InstallProgressOverlay } from "./InstallProgressOverlay";
import { Button } from "./ui";
import { useFonts } from "../fonts/FontsContext";

type AppWorkspaceProps = {
  workspacePanelRef: React.RefObject<HTMLElement | null>;
  webBrowserHostRef?: React.RefObject<HTMLDivElement | null>;
  webModeActive?: boolean;
  webSessionTitle?: string;
  webCaptureBusy?: boolean;
  webTranslateAfterCapture?: boolean;
  selectedPage: MangaPage | null;
  selectedPageImageDataUrl: string;
  imageRef: ImageStageProps["imageRef"];
  stageRef: ImageStageProps["stageRef"];
  stageSize: ImageStageProps["stageSize"];
  selectedBlockId: string | null;
  showTextBlocks: boolean;
  showBlockChrome: boolean;
  inpaintingMode: boolean;
  showingOriginalPeek: boolean;
  inpaintingToolActive: boolean;
  retouchCursor: ImageStageProps["retouchCursor"];
  retouchPreviewLayer: ImageStageProps["retouchPreview"];
  maskStrokes: ImageStageProps["maskStrokes"];
  regionSelectionActive: boolean;
  regionSelectionRect: ImageStageProps["regionSelectionRect"];
  jobState: JobState;
  progressSnapshot: ProgressSnapshot | null;
  onWorkspaceWheel: React.WheelEventHandler<HTMLElement>;
  fileDropActive?: boolean;
  onWorkspaceDragEnter?: React.DragEventHandler<HTMLElement>;
  onWorkspaceDragOver?: React.DragEventHandler<HTMLElement>;
  onWorkspaceDragLeave?: React.DragEventHandler<HTMLElement>;
  onWorkspaceDrop?: React.DragEventHandler<HTMLElement>;
  onStagePointerMove: ImageStageProps["onStagePointerMove"];
  onStagePointerUp: ImageStageProps["onStagePointerUp"];
  onStagePointerDown: ImageStageProps["onStagePointerDown"];
  onStagePointerLeave: ImageStageProps["onStagePointerLeave"];
  onBlockPointerDown: ImageStageProps["onBlockPointerDown"];
  onToggleBlockExcluded: ImageStageProps["onToggleBlockExcluded"];
  onOpenTranslationSource: () => void;
  onCaptureWebSegment?: () => void;
  onCloseWebBrowse?: () => void;
  onToggleWebTranslateAfterCapture?: (enabled: boolean) => void;
  onOpenBatchImport: () => void;
  onOpenShareImport: () => void;
};

export function AppWorkspace({
  workspacePanelRef,
  webBrowserHostRef,
  webModeActive = false,
  webSessionTitle,
  webCaptureBusy = false,
  webTranslateAfterCapture = false,
  selectedPage,
  selectedPageImageDataUrl,
  imageRef,
  stageRef,
  stageSize,
  selectedBlockId,
  showTextBlocks,
  showBlockChrome,
  inpaintingMode,
  showingOriginalPeek,
  inpaintingToolActive,
  retouchCursor,
  retouchPreviewLayer,
  maskStrokes,
  regionSelectionActive,
  regionSelectionRect,
  jobState,
  progressSnapshot,
  onWorkspaceWheel,
  fileDropActive = false,
  onWorkspaceDragEnter,
  onWorkspaceDragOver,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  onStagePointerMove,
  onStagePointerUp,
  onStagePointerDown,
  onStagePointerLeave,
  onBlockPointerDown,
  onToggleBlockExcluded,
  onOpenTranslationSource,
  onCaptureWebSegment,
  onCloseWebBrowse,
  onToggleWebTranslateAfterCapture,
  onOpenBatchImport,
  onOpenShareImport
}: AppWorkspaceProps): React.JSX.Element {
  // Subscribe to custom-font changes so overlay text re-resolves families when fonts load/register.
  useFonts();
  return (
    <section
      ref={workspacePanelRef}
      className={`workspace${fileDropActive ? " file-drop-active" : ""}`}
      tabIndex={0}
      aria-label="읽기 영역"
      onMouseDown={() => workspacePanelRef.current?.focus()}
      onWheel={onWorkspaceWheel}
      onDragEnter={onWorkspaceDragEnter}
      onDragOver={onWorkspaceDragOver}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      {webModeActive ? (
        <div className="web-workspace-split">
          <div className="web-browser-pane">
            <div className="web-browser-toolbar">
              <strong title={webSessionTitle}>{webSessionTitle || "웹 페이지"}</strong>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={webTranslateAfterCapture}
                  disabled={webCaptureBusy}
                  onChange={(event) => onToggleWebTranslateAfterCapture?.(event.target.checked)}
                />
                캡처 후 번역
              </label>
              <Button size="sm" variant="primary" disabled={webCaptureBusy} onClick={onCaptureWebSegment}>
                {webCaptureBusy ? "캡처 중" : "현재 화면 캡처"}
              </Button>
              <Button size="sm" onClick={onCloseWebBrowse}>
                닫기
              </Button>
            </div>
            <div ref={webBrowserHostRef} className="web-browser-host" aria-label="웹 브라우저 영역" />
          </div>
          <div className="web-capture-pane">
            {selectedPage ? (
              <WorkspaceStage
                selectedPage={selectedPage}
                selectedPageImageDataUrl={selectedPageImageDataUrl}
                imageRef={imageRef}
                stageRef={stageRef}
                stageSize={stageSize}
                selectedBlockId={selectedBlockId}
                showTextBlocks={showTextBlocks}
                showBlockChrome={showBlockChrome}
                inpaintingMode={inpaintingMode}
                inpaintingToolActive={inpaintingToolActive}
                retouchCursor={retouchCursor}
                retouchPreviewLayer={retouchPreviewLayer}
                maskStrokes={maskStrokes}
                regionSelectionActive={regionSelectionActive}
                regionSelectionRect={regionSelectionRect}
                fileDropActive={fileDropActive}
                onStagePointerMove={onStagePointerMove}
                onStagePointerUp={onStagePointerUp}
                onStagePointerDown={onStagePointerDown}
                onStagePointerLeave={onStagePointerLeave}
                onBlockPointerDown={onBlockPointerDown}
                onToggleBlockExcluded={onToggleBlockExcluded}
              />
            ) : (
              <div className="empty-state compact">
                <h2>아직 캡처한 화면이 없습니다.</h2>
                <p>왼쪽 웹 페이지를 이동한 뒤 현재 화면을 캡처하세요.</p>
              </div>
            )}
          </div>
        </div>
      ) : selectedPage ? (
        <div className="workspace-pane">
          {showingOriginalPeek ? <div className="peek-original-badge">원본</div> : null}
          <WorkspaceStage
            selectedPage={selectedPage}
            selectedPageImageDataUrl={selectedPageImageDataUrl}
            imageRef={imageRef}
            stageRef={stageRef}
            stageSize={stageSize}
            selectedBlockId={selectedBlockId}
            showTextBlocks={showTextBlocks}
            showBlockChrome={showBlockChrome}
            inpaintingMode={inpaintingMode}
            inpaintingToolActive={inpaintingToolActive}
            retouchCursor={retouchCursor}
            retouchPreviewLayer={retouchPreviewLayer}
            maskStrokes={maskStrokes}
            regionSelectionActive={regionSelectionActive}
            regionSelectionRect={regionSelectionRect}
            fileDropActive={fileDropActive}
            onStagePointerMove={onStagePointerMove}
            onStagePointerUp={onStagePointerUp}
            onStagePointerDown={onStagePointerDown}
            onStagePointerLeave={onStagePointerLeave}
            onBlockPointerDown={onBlockPointerDown}
            onToggleBlockExcluded={onToggleBlockExcluded}
          />
        </div>
      ) : (
        <div className="empty-state">
          <h2>보관함에서 화를 열거나 새로 가져오세요.</h2>
          <p>작품과 화 단위로 저장해두고, 이어서 번역하거나 페이지별로 다시 번역할 수 있습니다.</p>
          <div className="empty-actions">
            <Button variant="primary" onClick={onOpenTranslationSource}>
              번역
            </Button>
            <Button onClick={onOpenBatchImport}>작품 일괄 번역</Button>
            <Button onClick={onOpenShareImport}>가져오기</Button>
          </div>
        </div>
      )}
      <InstallProgressOverlay job={jobState} snapshot={progressSnapshot} />
    </section>
  );
}

function WorkspaceStage({
  selectedPage,
  selectedPageImageDataUrl,
  imageRef,
  stageRef,
  stageSize,
  selectedBlockId,
  showTextBlocks,
  showBlockChrome,
  inpaintingMode,
  inpaintingToolActive,
  retouchCursor,
  retouchPreviewLayer,
  maskStrokes,
  regionSelectionActive,
  regionSelectionRect,
  fileDropActive,
  onStagePointerMove,
  onStagePointerUp,
  onStagePointerDown,
  onStagePointerLeave,
  onBlockPointerDown,
  onToggleBlockExcluded
}: Pick<AppWorkspaceProps,
  | "selectedPage"
  | "selectedPageImageDataUrl"
  | "imageRef"
  | "stageRef"
  | "stageSize"
  | "selectedBlockId"
  | "showTextBlocks"
  | "showBlockChrome"
  | "inpaintingMode"
  | "inpaintingToolActive"
  | "retouchCursor"
  | "retouchPreviewLayer"
  | "maskStrokes"
  | "regionSelectionActive"
  | "regionSelectionRect"
  | "fileDropActive"
  | "onStagePointerMove"
  | "onStagePointerUp"
  | "onStagePointerDown"
  | "onStagePointerLeave"
  | "onBlockPointerDown"
  | "onToggleBlockExcluded"
> & { selectedPage: MangaPage }): React.JSX.Element {
  return (
    <ImageStage
      page={selectedPage}
      imageDataUrl={selectedPageImageDataUrl}
      imageRef={imageRef}
      stageRef={stageRef}
      stageSize={stageSize}
      selectedBlockId={selectedBlockId}
      showTextBlocks={showTextBlocks}
      showBlockChrome={showBlockChrome && !inpaintingToolActive}
      inpaintingMode={inpaintingMode}
      blockPointerDisabled={inpaintingToolActive}
      retouchCursor={retouchCursor}
      retouchPreview={retouchPreviewLayer}
      maskStrokes={maskStrokes}
      regionSelectionActive={regionSelectionActive}
      regionSelectionRect={regionSelectionRect}
      fileDropActive={fileDropActive}
      onStagePointerMove={onStagePointerMove}
      onStagePointerUp={onStagePointerUp}
      onStagePointerDown={onStagePointerDown}
      onStagePointerLeave={onStagePointerLeave}
      onBlockPointerDown={onBlockPointerDown}
      onToggleBlockExcluded={onToggleBlockExcluded}
    />
  );
}

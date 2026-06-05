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
  webBrowserCollapsed?: boolean;
  webOverlaySelectionEnabled?: boolean;
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
  onReloadWebBrowse?: () => void;
  onReapplyWebTranslationOverlay?: () => void;
  onCloseWebBrowse?: () => void;
  onToggleWebBrowserCollapsed?: () => void;
  onToggleWebOverlaySelection?: (enabled: boolean) => void;
  onToggleWebTranslateAfterCapture?: (enabled: boolean) => void;
  onOpenBatchImport: () => void;
  onOpenShareImport: () => void;
};

export function AppWorkspace({
  workspacePanelRef,
  webBrowserHostRef,
  webModeActive = false,
  webSessionTitle,
  webBrowserCollapsed = false,
  webOverlaySelectionEnabled = false,
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
  onReloadWebBrowse,
  onReapplyWebTranslationOverlay,
  onCloseWebBrowse,
  onToggleWebBrowserCollapsed,
  onToggleWebOverlaySelection,
  onToggleWebTranslateAfterCapture,
  onOpenBatchImport,
  onOpenShareImport
}: AppWorkspaceProps): React.JSX.Element {
  // Subscribe to custom-font changes so overlay text re-resolves families when fonts load/register.
  useFonts();
  const showWebEditStage = webBrowserCollapsed;
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
        <div className="web-workspace-single">
          <div className="web-browser-pane">
            <div className="web-browser-toolbar">
              <strong title={webSessionTitle}>{webSessionTitle || "웹 페이지"}</strong>
              <Button size="sm" onClick={onReloadWebBrowse} disabled={webCaptureBusy || jobState.status === "running" || jobState.status === "starting"}>
                새로고침
              </Button>
              <Button size="sm" onClick={onReapplyWebTranslationOverlay} disabled={webCaptureBusy || !selectedPage?.webMeta}>
                번역 다시 적용
              </Button>
              <Button size="sm" onClick={onToggleWebBrowserCollapsed}>
                {webBrowserCollapsed ? "펼치기" : "접기"}
              </Button>
              <label className="web-toolbar-check">
                <input
                  type="checkbox"
                  checked={webOverlaySelectionEnabled}
                  onChange={(event) => onToggleWebOverlaySelection?.(event.currentTarget.checked)}
                />
                <span>블록 선택가능</span>
              </label>
              <Button size="sm" onClick={onCloseWebBrowse}>
                닫기
              </Button>
            </div>
            {showWebEditStage ? (
              selectedPage ? (
                <div className="web-collapsed-stage">
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
                  <h2>캡처된 웹 페이지가 없습니다.</h2>
                  <p>현재 화면 번역을 실행하면 캡처 이미지와 텍스트 블록이 보관함에 저장됩니다.</p>
                </div>
              )
            ) : (
              <div ref={webBrowserHostRef} className="web-browser-host" aria-label="웹 브라우저 영역" />
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

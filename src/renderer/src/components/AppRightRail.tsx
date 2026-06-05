import React from "react";
import type { ChapterSnapshot, JobState, MangaPage, TranslationBlock } from "../../../shared/types";
import type { ProgressSnapshot } from "../lib/jobProgress";
import { EditorPanel } from "./EditorPanel";
import { DisplayControlPanel, InpaintingControlPanel } from "./InpaintingControlPanel";
import { RunPanel, StatusPanel } from "./RunStatusPanels";

type AppRightRailProps = {
  inpaintingMode: boolean;
  currentChapter: ChapterSnapshot | null;
  selectedPage: MangaPage | null;
  selectedBlock: TranslationBlock | null;
  selectedPageImageDataUrl: string;
  selectedPageEditLocked: boolean;
  jobState: JobState;
  progressSnapshot: ProgressSnapshot | null;
  showProgressBar: boolean;
  showBlockChrome: boolean;
  showTextBlocks: boolean;
  jobActive: boolean;
  statusLines: string[];
  areaTranslateSelecting: boolean;
  onToggleChrome: () => void;
  onToggleBlocks: () => void;
  onEnableBlockChrome: () => void;
  onRunPending: () => void;
  onRunAll: () => void;
  onEnterInpainting: () => void;
  onWebTranslateCurrent: () => void;
  onWebTranslateFullPage: () => void;
  onWebTranslateRegion: () => void;
  webSessionActive: boolean;
  onCancelJob: () => void;
  onStartAreaTranslate: () => void;
  onSampleBlockBackground: () => void;
  onSamplePageBackgrounds: () => void;
  onApplyFont: (scope: "page" | "chapter") => void;
  onUpdateBlock: (patch: Partial<TranslationBlock>) => void;
  onDeleteBlock: () => void;
  onDuplicateBlock: () => void;
};

export function AppRightRail({
  inpaintingMode,
  currentChapter,
  selectedPage,
  selectedBlock,
  selectedPageImageDataUrl,
  selectedPageEditLocked,
  jobState,
  progressSnapshot,
  showProgressBar,
  showBlockChrome,
  showTextBlocks,
  jobActive,
  statusLines,
  areaTranslateSelecting,
  onToggleChrome,
  onToggleBlocks,
  onEnableBlockChrome,
  onRunPending,
  onRunAll,
  onEnterInpainting,
  onWebTranslateCurrent,
  onWebTranslateFullPage,
  onWebTranslateRegion,
  webSessionActive,
  onCancelJob,
  onStartAreaTranslate,
  onSampleBlockBackground,
  onSamplePageBackgrounds,
  onApplyFont,
  onUpdateBlock,
  onDeleteBlock,
  onDuplicateBlock
}: AppRightRailProps): React.JSX.Element {
  const editorDisabled = selectedPageEditLocked || jobActive;

  return (
    <aside className={`right-rail ${inpaintingMode ? "inpainting-rail" : ""}`}>
      {inpaintingMode ? (
        <>
          <InpaintingControlPanel />
          {selectedBlock ? (
            <EditorPanel
              block={selectedBlock}
              disabled={editorDisabled}
              showBlockChrome={showBlockChrome}
              onEnableBlockChrome={onEnableBlockChrome}
              pageBlockCount={selectedPage?.blocks.length ?? 0}
              onSampleBackground={onSampleBlockBackground}
              onSamplePageBackgrounds={onSamplePageBackgrounds}
              onApplyFont={onApplyFont}
              onUpdate={onUpdateBlock}
              onDelete={onDeleteBlock}
              onDuplicate={onDuplicateBlock}
            />
          ) : null}
        </>
      ) : (
        <>
          <RunPanel
            currentChapter={currentChapter}
            jobActive={jobActive}
            showProgressBar={showProgressBar}
            progressSnapshot={progressSnapshot}
            jobState={jobState}
            onRunPending={onRunPending}
            onRunAll={onRunAll}
            onEnterInpainting={onEnterInpainting}
            onWebTranslateCurrent={onWebTranslateCurrent}
            onWebTranslateFullPage={onWebTranslateFullPage}
            onWebTranslateRegion={onWebTranslateRegion}
            webSessionActive={webSessionActive}
            onCancelJob={onCancelJob}
          />

          <DisplayControlPanel showBlockChrome={showBlockChrome} showTextBlocks={showTextBlocks} onToggleChrome={onToggleChrome} onToggleBlocks={onToggleBlocks} />

          {!selectedBlock ? <StatusPanel jobState={jobState} statusLines={statusLines} /> : null}

          <EditorPanel
            block={selectedBlock}
            disabled={editorDisabled}
            showBlockChrome={showBlockChrome}
            onEnableBlockChrome={onEnableBlockChrome}
            areaTranslateAvailable={Boolean(selectedPage && selectedPageImageDataUrl && !jobActive)}
            areaTranslateSelecting={areaTranslateSelecting}
            onStartAreaTranslate={onStartAreaTranslate}
            pageBlockCount={selectedPage?.blocks.length ?? 0}
            onSampleBackground={onSampleBlockBackground}
            onSamplePageBackgrounds={onSamplePageBackgrounds}
            onApplyFont={onApplyFont}
            onUpdate={onUpdateBlock}
            onDelete={onDeleteBlock}
            onDuplicate={onDuplicateBlock}
          />
        </>
      )}
    </aside>
  );
}

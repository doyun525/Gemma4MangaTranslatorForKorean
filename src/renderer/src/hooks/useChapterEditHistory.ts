import React, { useCallback, useRef } from "react";
import type { ChapterSnapshot } from "../../../shared/types";

const MAX_HISTORY = 60;
const BURST_COALESCE_MS = 450;

export type ChapterEditSnapshot = {
  chapter: ChapterSnapshot;
  selectedPageId: string | null;
  selectedBlockId: string | null;
};

function cloneChapterSnapshot(chapter: ChapterSnapshot): ChapterSnapshot {
  return JSON.parse(JSON.stringify(chapter)) as ChapterSnapshot;
}

function cloneChapterEditSnapshot(snapshot: ChapterEditSnapshot): ChapterEditSnapshot {
  return {
    chapter: cloneChapterSnapshot(snapshot.chapter),
    selectedPageId: snapshot.selectedPageId,
    selectedBlockId: snapshot.selectedBlockId
  };
}

export function useChapterEditHistory(chapterId: string | null): {
  clearHistory: () => void;
  recordEditHistory: (snapshot: ChapterEditSnapshot, options?: { force?: boolean }) => void;
  undoEdit: (current: ChapterEditSnapshot) => ChapterEditSnapshot | null;
  redoEdit: (current: ChapterEditSnapshot) => ChapterEditSnapshot | null;
  canUndoEdit: boolean;
  canRedoEdit: boolean;
} {
  const undoStackRef = useRef<ChapterEditSnapshot[]>([]);
  const redoStackRef = useRef<ChapterEditSnapshot[]>([]);
  const lastRecordAtRef = useRef(0);
  const [, setRevision] = useStateRevision();

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastRecordAtRef.current = 0;
    setRevision();
  }, [setRevision]);

  React.useEffect(() => {
    clearHistory();
  }, [chapterId, clearHistory]);

  const recordEditHistory = useCallback(
    (snapshot: ChapterEditSnapshot, options?: { force?: boolean }) => {
      const now = Date.now();
      if (!options?.force && now - lastRecordAtRef.current < BURST_COALESCE_MS) {
        return;
      }
      lastRecordAtRef.current = now;

      undoStackRef.current = [...undoStackRef.current, cloneChapterEditSnapshot(snapshot)].slice(-MAX_HISTORY);
      redoStackRef.current = [];
      setRevision();
    },
    [setRevision]
  );

  const undoEdit = useCallback(
    (current: ChapterEditSnapshot): ChapterEditSnapshot | null => {
      const entry = undoStackRef.current[undoStackRef.current.length - 1];
      if (!entry) {
        return null;
      }

      undoStackRef.current = undoStackRef.current.slice(0, -1);
      redoStackRef.current = [...redoStackRef.current, cloneChapterEditSnapshot(current)].slice(-MAX_HISTORY);
      lastRecordAtRef.current = 0;
      setRevision();
      return entry;
    },
    [setRevision]
  );

  const redoEdit = useCallback(
    (current: ChapterEditSnapshot): ChapterEditSnapshot | null => {
      const entry = redoStackRef.current[redoStackRef.current.length - 1];
      if (!entry) {
        return null;
      }

      redoStackRef.current = redoStackRef.current.slice(0, -1);
      undoStackRef.current = [...undoStackRef.current, cloneChapterEditSnapshot(current)].slice(-MAX_HISTORY);
      lastRecordAtRef.current = 0;
      setRevision();
      return entry;
    },
    [setRevision]
  );

  return {
    clearHistory,
    recordEditHistory,
    undoEdit,
    redoEdit,
    canUndoEdit: undoStackRef.current.length > 0,
    canRedoEdit: redoStackRef.current.length > 0
  };
}

function useStateRevision(): [number, () => void] {
  const [revision, setRevisionValue] = React.useState(0);
  const bump = useCallback(() => {
    setRevisionValue((value) => value + 1);
  }, []);
  return [revision, bump];
}

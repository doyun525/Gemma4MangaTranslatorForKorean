import React from "react";
import type { ImportTarget, LibraryIndex, OpenWebBrowseRequest } from "../../../shared/types";
import { Button, Modal, SelectField, TextField } from "./ui";

type WebBrowseModalProps = {
  library: LibraryIndex;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (request: OpenWebBrowseRequest) => void;
};

export function WebBrowseModal({ library, busy, onCancel, onSubmit }: WebBrowseModalProps): React.JSX.Element {
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [targetMode, setTargetMode] = React.useState<ImportTarget["mode"]>("new");
  const [existingWorkId, setExistingWorkId] = React.useState(library.works[0]?.id ?? "");
  const [newWorkTitle, setNewWorkTitle] = React.useState("웹 번역");
  const trimmedUrl = url.trim();
  const canSubmit = Boolean(trimmedUrl && (targetMode === "new" ? newWorkTitle.trim() : existingWorkId));

  React.useEffect(() => {
    if (!existingWorkId && library.works[0]) {
      setExistingWorkId(library.works[0].id);
    }
  }, [existingWorkId, library.works]);

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    const target: ImportTarget =
      targetMode === "new"
        ? { mode: "new", title: newWorkTitle.trim() || "웹 번역" }
        : { mode: "existing", workId: existingWorkId };
    onSubmit({
      url: normalizeUrl(trimmedUrl),
      title: title.trim() || undefined,
      target,
      mode: "manual"
    });
  };

  return (
    <Modal
      title="웹에서 열기"
      onClose={busy ? undefined : onCancel}
      size="md"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !canSubmit}>
            열기
          </Button>
        </>
      }
    >
      <div className="web-modal-form">
        <TextField
          label="URL"
          placeholder="https://example.com/comic"
          value={url}
          disabled={busy}
          autoFocus
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submit();
            }
          }}
        />
        <TextField label="화 제목" placeholder="비워두면 페이지 제목 사용" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        <SelectField label="저장 위치" value={targetMode} disabled={busy} onChange={(event) => setTargetMode(event.target.value as ImportTarget["mode"])}>
          <option value="new">새 작품</option>
          <option value="existing" disabled={library.works.length === 0}>
            기존 작품
          </option>
        </SelectField>
        {targetMode === "new" ? (
          <TextField label="새 작품명" value={newWorkTitle} disabled={busy} onChange={(event) => setNewWorkTitle(event.target.value)} />
        ) : (
          <SelectField label="작품 선택" value={existingWorkId} disabled={busy} onChange={(event) => setExistingWorkId(event.target.value)}>
            {library.works.map((work) => (
              <option key={work.id} value={work.id}>
                {work.title}
              </option>
            ))}
          </SelectField>
        )}
      </div>
    </Modal>
  );
}

function normalizeUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

import React from "react";
import type {
  AppSettings,
  CodexReasoningEffort,
  GemmaCustomModelPreset,
  GemmaVramMode,
  ModelTestProgressEvent,
  ModelProvider,
  ModelSource,
  OcrDevice,
  OcrEngine,
  TranslationMode
} from "../../../shared/types";
import {
  CODEX_REASONING_OPTIONS,
  DEFAULT_MODEL_PRESET_ID,
  DEFAULT_GEMMA_MODEL_REPO,
  DEFAULT_OCR_BATCH_SIZE,
  DEFAULT_OCR_BBOX_EXPAND_X_PERCENT,
  DEFAULT_OCR_BBOX_EXPAND_Y_PERCENT,
  DEFAULT_TEXT_OUTLINE_WIDTH_PX,
  DEFAULT_TRANSLATION_MODE,
  GEMMA_VRAM_MODE_OPTIONS,
  MAX_MAX_TOKENS,
  MAX_OCR_BATCH_SIZE,
  MAX_OCR_BBOX_EXPAND_PERCENT,
  MAX_TEXT_OUTLINE_WIDTH_PX,
  MIN_MAX_TOKENS,
  MIN_OCR_BATCH_SIZE,
  MIN_OCR_BBOX_EXPAND_PERCENT,
  MIN_TEXT_OUTLINE_WIDTH_PX,
  MODEL_PRESETS,
  MODEL_PROVIDER_OPTIONS,
  MODEL_SOURCE_OPTIONS,
  OCR_DEVICE_OPTIONS,
  OCR_ENGINE_OPTIONS,
  TRANSLATION_MODE_OPTIONS,
  resolveModelPreset,
  type ModelPresetId
} from "./settingsOptions";
import { Button, Modal } from "./ui";

const MODEL_PRESET_BUTTON_IDS = [
  ...Object.keys(MODEL_PRESETS),
  "custom"
] as ModelPresetId[];

type TestState =
  | {
      status: "idle";
      message: null;
      detail: null;
    }
  | {
      status: "running" | "success" | "error";
      message: string;
      detail: string | null;
    };

type SettingsModalProps = {
  initialSettings: AppSettings;
  busy: boolean;
  jobActive: boolean;
  onCancel: () => void;
  onOpenLogFolder: () => void;
  onReset: () => void;
  onSubmit: (settings: AppSettings) => void;
};

export function SettingsModal({
  initialSettings,
  busy,
  jobActive,
  onCancel,
  onOpenLogFolder,
  onReset,
  onSubmit
}: SettingsModalProps): React.JSX.Element {
  const [modelProvider, setModelProvider] = React.useState<ModelProvider>(initialSettings.modelProvider);
  const [modelSource, setModelSource] = React.useState<ModelSource>(initialSettings.gemma.modelSource);
  const [selectedPreset, setSelectedPreset] = React.useState<ModelPresetId>(() =>
    resolveModelPreset(initialSettings.gemma.modelRepo, initialSettings.gemma.modelFile)
  );
  const [customModelRepo, setCustomModelRepo] = React.useState(initialSettings.gemma.modelRepo);
  const [customModelFile, setCustomModelFile] = React.useState(initialSettings.gemma.modelFile);
  const [customModelPresets, setCustomModelPresets] = React.useState<GemmaCustomModelPreset[]>(
    initialSettings.gemma.customModelPresets ?? []
  );
  const [selectedCustomPresetId, setSelectedCustomPresetId] = React.useState(() =>
    resolveInitialCustomPresetId(
      initialSettings.gemma.customModelPresets ?? [],
      initialSettings.gemma.modelRepo,
      initialSettings.gemma.modelFile
    )
  );
  const [localModelPath, setLocalModelPath] = React.useState(initialSettings.gemma.localModelPath ?? "");
  const [localMmprojPath, setLocalMmprojPath] = React.useState(initialSettings.gemma.localMmprojPath ?? "");
  const [customVramMode, setCustomVramMode] = React.useState<GemmaVramMode>(initialSettings.gemma.vramMode);
  const [codexModel, setCodexModel] = React.useState(initialSettings.codex.model);
  const [codexReasoningEffort, setCodexReasoningEffort] = React.useState<CodexReasoningEffort>(
    initialSettings.codex.reasoningEffort
  );
  const [codexOauthPort, setCodexOauthPort] = React.useState(String(initialSettings.codex.oauthPort));
  const [ocrDevice, setOcrDevice] = React.useState<OcrDevice>(initialSettings.ocr.device);
  const [ocrEngine, setOcrEngine] = React.useState<OcrEngine>(initialSettings.ocr.engine ?? "paddleocr-v5");
  const [ocrBatchSize, setOcrBatchSize] = React.useState(
    numberToInput(initialSettings.ocr.batchSize, DEFAULT_OCR_BATCH_SIZE)
  );
  const [translationMode, setTranslationMode] = React.useState<TranslationMode>(
    resolveTranslationMode(initialSettings.translation?.mode)
  );
  const [includeSoundEffects, setIncludeSoundEffects] = React.useState(initialSettings.translation.includeSoundEffects);
  const [ocrBboxExpandXPercent, setOcrBboxExpandXPercent] = React.useState(
    ratioToPercentInput(initialSettings.translation.ocrBboxExpandXRatio, DEFAULT_OCR_BBOX_EXPAND_X_PERCENT)
  );
  const [ocrBboxExpandYPercent, setOcrBboxExpandYPercent] = React.useState(
    ratioToPercentInput(initialSettings.translation.ocrBboxExpandYRatio, DEFAULT_OCR_BBOX_EXPAND_Y_PERCENT)
  );
  const [textOutlineWidthPx, setTextOutlineWidthPx] = React.useState(
    numberToInput(initialSettings.translation.textOutlineWidthPx, DEFAULT_TEXT_OUTLINE_WIDTH_PX)
  );
  const [maxTokens, setMaxTokens] = React.useState(String(initialSettings.maxTokens));
  const [localActionBusy, setLocalActionBusy] = React.useState(false);
  const [testState, setTestState] = React.useState<TestState>({ status: "idle", message: null, detail: null });
  const [testLogLines, setTestLogLines] = React.useState<string[]>([]);
  const modelRepoInputRef = React.useRef<HTMLInputElement | null>(null);
  const localModelInputRef = React.useRef<HTMLInputElement | null>(null);
  const testLogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setModelProvider(initialSettings.modelProvider);
    setModelSource(initialSettings.gemma.modelSource);
    setSelectedPreset(resolveModelPreset(initialSettings.gemma.modelRepo, initialSettings.gemma.modelFile));
    setCustomModelRepo(initialSettings.gemma.modelRepo);
    setCustomModelFile(initialSettings.gemma.modelFile);
    setCustomModelPresets(initialSettings.gemma.customModelPresets ?? []);
    setSelectedCustomPresetId(
      resolveInitialCustomPresetId(
        initialSettings.gemma.customModelPresets ?? [],
        initialSettings.gemma.modelRepo,
        initialSettings.gemma.modelFile
      )
    );
    setLocalModelPath(initialSettings.gemma.localModelPath ?? "");
    setLocalMmprojPath(initialSettings.gemma.localMmprojPath ?? "");
    setCustomVramMode(initialSettings.gemma.vramMode);
    setCodexModel(initialSettings.codex.model);
    setCodexReasoningEffort(initialSettings.codex.reasoningEffort);
    setCodexOauthPort(String(initialSettings.codex.oauthPort));
    setOcrDevice(initialSettings.ocr.device);
    setOcrEngine(initialSettings.ocr.engine ?? "paddleocr-v5");
    setOcrBatchSize(numberToInput(initialSettings.ocr.batchSize, DEFAULT_OCR_BATCH_SIZE));
    setTranslationMode(resolveTranslationMode(initialSettings.translation?.mode));
    setIncludeSoundEffects(initialSettings.translation.includeSoundEffects);
    setOcrBboxExpandXPercent(
      ratioToPercentInput(initialSettings.translation.ocrBboxExpandXRatio, DEFAULT_OCR_BBOX_EXPAND_X_PERCENT)
    );
    setOcrBboxExpandYPercent(
      ratioToPercentInput(initialSettings.translation.ocrBboxExpandYRatio, DEFAULT_OCR_BBOX_EXPAND_Y_PERCENT)
    );
    setTextOutlineWidthPx(numberToInput(initialSettings.translation.textOutlineWidthPx, DEFAULT_TEXT_OUTLINE_WIDTH_PX));
    setMaxTokens(String(initialSettings.maxTokens));
    setTestState({ status: "idle", message: null, detail: null });
    setTestLogLines([]);
  }, [initialSettings]);

  React.useEffect(() => {
    if (!testLogRef.current) {
      return;
    }
    testLogRef.current.scrollTop = testLogRef.current.scrollHeight;
  }, [testLogLines]);

  React.useEffect(() => {
    if (modelProvider === "openai-codex") {
      return;
    }
    if (modelSource === "local") {
      localModelInputRef.current?.focus();
      localModelInputRef.current?.select();
      return;
    }
    if (selectedPreset === "custom") {
      modelRepoInputRef.current?.focus();
      modelRepoInputRef.current?.select();
    }
  }, [modelProvider, modelSource, selectedPreset]);

  const controlsBusy = busy || localActionBusy || testState.status === "running";
  const activePreset = modelSource === "huggingface" && selectedPreset !== "custom" ? MODEL_PRESETS[selectedPreset] : null;
  const trimmedModelRepo = (activePreset?.modelRepo ?? customModelRepo).trim();
  const trimmedModelFile = (activePreset?.modelFile ?? customModelFile).trim();
  const trimmedMmprojRepo = activePreset?.mmprojRepo;
  const trimmedMmprojFile = activePreset?.mmprojFile;
  const normalizedCustomModelPresets = React.useMemo(
    () => normalizeCustomModelPresetsForSettings(customModelPresets),
    [customModelPresets]
  );
  const customModelPresetsForSave = React.useMemo(() => {
    const modelRepo = customModelRepo.trim();
    const modelFile = customModelFile.trim();
    if (modelSource !== "huggingface" || selectedPreset !== "custom" || !modelRepo || !modelFile) {
      return normalizedCustomModelPresets;
    }

    const existingPreset =
      normalizedCustomModelPresets.find((preset) => preset.id === selectedCustomPresetId) ??
      normalizedCustomModelPresets.find((preset) => sameCustomModelPreset(preset, modelRepo, modelFile));
    const currentPreset: GemmaCustomModelPreset = {
      id: existingPreset?.id ?? createCustomPresetId(modelRepo, modelFile, normalizedCustomModelPresets),
      label: existingPreset?.label ?? buildCustomPresetLabel(modelRepo, modelFile),
      modelRepo,
      modelFile
    };
    return normalizeCustomModelPresetsForSettings(upsertCustomModelPreset(normalizedCustomModelPresets, currentPreset));
  }, [
    customModelFile,
    customModelRepo,
    modelSource,
    normalizedCustomModelPresets,
    selectedCustomPresetId,
    selectedPreset
  ]);
  const selectedVramMode = activePreset?.vramMode ?? customVramMode;
  const trimmedLocalModelPath = localModelPath.trim();
  const trimmedLocalMmprojPath = localMmprojPath.trim();
  const trimmedCodexModel = codexModel.trim();
  const parsedCodexOauthPort = Number(codexOauthPort);
  const parsedMaxTokens = Number(maxTokens);
  const parsedOcrBatchSize = Number(ocrBatchSize);
  const parsedOcrBboxExpandXPercent = Number(ocrBboxExpandXPercent);
  const parsedOcrBboxExpandYPercent = Number(ocrBboxExpandYPercent);
  const parsedTextOutlineWidthPx = Number(textOutlineWidthPx);
  const codexOauthPortValid =
    Number.isInteger(parsedCodexOauthPort) && parsedCodexOauthPort >= 0 && parsedCodexOauthPort <= 65535;
  const maxTokensValid =
    Number.isInteger(parsedMaxTokens) && parsedMaxTokens >= MIN_MAX_TOKENS && parsedMaxTokens <= MAX_MAX_TOKENS;
  const ocrBatchSizeValid =
    Number.isInteger(parsedOcrBatchSize) &&
    parsedOcrBatchSize >= MIN_OCR_BATCH_SIZE &&
    parsedOcrBatchSize <= MAX_OCR_BATCH_SIZE;
  const ocrBboxExpandValid =
    isValidPercent(parsedOcrBboxExpandXPercent) && isValidPercent(parsedOcrBboxExpandYPercent);
  const textOutlineWidthValid =
    Number.isFinite(parsedTextOutlineWidthPx) &&
    parsedTextOutlineWidthPx >= MIN_TEXT_OUTLINE_WIDTH_PX &&
    parsedTextOutlineWidthPx <= MAX_TEXT_OUTLINE_WIDTH_PX;
  const gemmaSettingsReady = modelSource === "local" ? Boolean(trimmedLocalModelPath) : Boolean(trimmedModelRepo && trimmedModelFile);
  const canSubmit = Boolean(
    maxTokensValid &&
      ocrBatchSizeValid &&
      ocrBboxExpandValid &&
      textOutlineWidthValid &&
      (modelProvider === "openai-codex" ? trimmedCodexModel && codexOauthPortValid : gemmaSettingsReady)
  );

  const buildOcrSettings = () => ({
    device: ocrDevice,
    engine: ocrEngine,
    batchSize: parsedOcrBatchSize,
    ...(initialSettings.ocr.gpuCudaTag ? { gpuCudaTag: initialSettings.ocr.gpuCudaTag } : {})
  });

  const buildTranslationSettings = () => ({
    mode: resolveTranslationMode(translationMode),
    includeSoundEffects,
    ocrBboxExpandXRatio: parsedOcrBboxExpandXPercent / 100,
    ocrBboxExpandYRatio: parsedOcrBboxExpandYPercent / 100,
    textOutlineWidthPx: parsedTextOutlineWidthPx
  });

  const buildSettings = React.useCallback((): AppSettings | null => {
    if (!maxTokensValid || !ocrBatchSizeValid || !ocrBboxExpandValid || !textOutlineWidthValid) {
      return null;
    }

    if (modelProvider === "openai-codex") {
      if (!trimmedCodexModel || !codexOauthPortValid) {
        return null;
      }

      return {
        modelProvider,
        gemma: {
          modelSource,
          modelRepo: trimmedModelRepo || DEFAULT_GEMMA_MODEL_REPO,
          modelFile: trimmedModelFile || MODEL_PRESETS[DEFAULT_MODEL_PRESET_ID].modelFile,
          ...(trimmedMmprojRepo ? { mmprojRepo: trimmedMmprojRepo } : {}),
          ...(trimmedMmprojFile ? { mmprojFile: trimmedMmprojFile } : {}),
          ...(trimmedLocalModelPath ? { localModelPath: trimmedLocalModelPath } : {}),
          ...(trimmedLocalMmprojPath ? { localMmprojPath: trimmedLocalMmprojPath } : {}),
          customModelPresets: customModelPresetsForSave,
          vramMode: selectedVramMode
        },
        codex: {
          model: trimmedCodexModel,
          reasoningEffort: codexReasoningEffort,
          oauthPort: parsedCodexOauthPort
        },
        ocr: buildOcrSettings(),
        translation: buildTranslationSettings(),
        ...(initialSettings.storage ? { storage: initialSettings.storage } : {}),
        maxTokens: parsedMaxTokens
      };
    }

    return {
      modelProvider,
      gemma: {
        modelSource,
        modelRepo: trimmedModelRepo || DEFAULT_GEMMA_MODEL_REPO,
        modelFile: trimmedModelFile || MODEL_PRESETS[DEFAULT_MODEL_PRESET_ID].modelFile,
        ...(trimmedMmprojRepo ? { mmprojRepo: trimmedMmprojRepo } : {}),
        ...(trimmedMmprojFile ? { mmprojFile: trimmedMmprojFile } : {}),
        ...(trimmedLocalModelPath ? { localModelPath: trimmedLocalModelPath } : {}),
        ...(trimmedLocalMmprojPath ? { localMmprojPath: trimmedLocalMmprojPath } : {}),
        customModelPresets: customModelPresetsForSave,
        vramMode: selectedVramMode
      },
      codex: {
        model: trimmedCodexModel || initialSettings.codex.model,
        reasoningEffort: codexReasoningEffort,
        oauthPort: codexOauthPortValid ? parsedCodexOauthPort : initialSettings.codex.oauthPort
      },
      ocr: buildOcrSettings(),
      translation: buildTranslationSettings(),
      ...(initialSettings.storage ? { storage: initialSettings.storage } : {}),
      maxTokens: parsedMaxTokens
    };
  }, [
    modelProvider,
    codexOauthPortValid,
    modelSource,
    trimmedModelRepo,
    trimmedModelFile,
    trimmedMmprojRepo,
    trimmedMmprojFile,
    trimmedLocalModelPath,
    trimmedLocalMmprojPath,
    customModelPresetsForSave,
    trimmedCodexModel,
    parsedCodexOauthPort,
    parsedMaxTokens,
    parsedOcrBatchSize,
    parsedOcrBboxExpandXPercent,
    parsedOcrBboxExpandYPercent,
    parsedTextOutlineWidthPx,
    selectedVramMode,
    codexReasoningEffort,
    ocrDevice,
    ocrEngine,
    ocrBatchSizeValid,
    translationMode,
    includeSoundEffects,
    ocrBboxExpandValid,
    textOutlineWidthValid,
    initialSettings.codex.model,
    initialSettings.codex.oauthPort,
    initialSettings.ocr.gpuCudaTag,
    initialSettings.storage,
    maxTokensValid
  ]);

  const clearTestState = React.useCallback(() => {
    setTestState({ status: "idle", message: null, detail: null });
    setTestLogLines([]);
  }, []);

  const saveCurrentCustomPreset = React.useCallback(() => {
    const modelRepo = customModelRepo.trim();
    const modelFile = customModelFile.trim();
    if (!modelRepo || !modelFile) {
      return;
    }

    const existingPreset =
      customModelPresets.find((preset) => preset.id === selectedCustomPresetId) ??
      customModelPresets.find((preset) => sameCustomModelPreset(preset, modelRepo, modelFile));
    const nextPreset: GemmaCustomModelPreset = {
      id: existingPreset?.id ?? createCustomPresetId(modelRepo, modelFile, customModelPresets),
      label: existingPreset?.label ?? buildCustomPresetLabel(modelRepo, modelFile),
      modelRepo,
      modelFile
    };

    setCustomModelPresets((current) => upsertCustomModelPreset(current, nextPreset));
    setSelectedCustomPresetId(nextPreset.id);
    clearTestState();
  }, [clearTestState, customModelFile, customModelPresets, customModelRepo, selectedCustomPresetId]);

  const deleteSelectedCustomPreset = React.useCallback(() => {
    if (!selectedCustomPresetId) {
      return;
    }
    setCustomModelPresets((current) => current.filter((preset) => preset.id !== selectedCustomPresetId));
    setSelectedCustomPresetId("");
    clearTestState();
  }, [clearTestState, selectedCustomPresetId]);

  const appendTestLogLine = React.useCallback((line: string) => {
    const normalized = line.trim();
    if (!normalized) {
      return;
    }
    setTestLogLines((current) => {
      if (current[current.length - 1] === normalized) {
        return current;
      }
      return [...current, normalized].slice(-180);
    });
  }, []);

  const submit = () => {
    const nextSettings = buildSettings();
    if (!nextSettings || !canSubmit) {
      return;
    }
    onSubmit(nextSettings);
  };

  const pickLocalModelFile = async () => {
    setLocalActionBusy(true);
    try {
      const picked = await window.mangaApi.pickLocalModelFile();
      if (!picked) {
        return;
      }
      clearTestState();
      setLocalModelPath(picked.modelPath);
      if (picked.detectedMmprojPath) {
        setLocalMmprojPath(picked.detectedMmprojPath);
      }
    } finally {
      setLocalActionBusy(false);
    }
  };

  const pickLocalMmprojFile = async () => {
    setLocalActionBusy(true);
    try {
      const picked = await window.mangaApi.pickLocalMmprojFile();
      if (!picked) {
        return;
      }
      clearTestState();
      setLocalMmprojPath(picked);
    } finally {
      setLocalActionBusy(false);
    }
  };

  const runModelTest = async () => {
    const nextSettings = buildSettings();
    if (!nextSettings || !canSubmit || jobActive) {
      return;
    }

    const testId = `settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTestLogLines(["모델 테스트를 시작합니다."]);
    setTestState({
      status: "running",
      message: "모델을 불러오고 간단한 텍스트 응답을 확인하는 중입니다...",
      detail: "이 테스트는 모델 로드와 텍스트 응답만 확인합니다."
    });
    const unsubscribe = window.mangaApi.onModelTestEvent((event) => {
      if (event.id !== testId) {
        return;
      }
      appendTestLogLine(formatModelTestProgressLine(event));
      setTestState((current) =>
        current.status === "running"
          ? {
              status: "running",
              message: event.progressText,
              detail: event.detail ?? current.detail
            }
          : current
      );
    });
    try {
      const result = await window.mangaApi.testModelSettings(nextSettings, testId);
      appendTestLogLine(result.ok ? "모델 테스트가 완료되었습니다." : "모델 테스트가 실패했습니다.");
      setTestState({
        status: result.ok ? "success" : "error",
        message: result.message,
        detail: buildTestDetail(result.resolvedModelPath, result.resolvedMmprojPath, result.resolvedEndpoint)
      });
    } catch (error) {
      appendTestLogLine("모델 테스트 요청 중 오류가 발생했습니다.");
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        detail: null
      });
    } finally {
      unsubscribe();
    }
  };

  return (
    <Modal
      width="min(680px, 100%)"
      ariaLabel="설정"
      title="설정"
      onClose={onCancel}
      closeDisabled={controlsBusy}
      footer={
        <>
          <Button variant="ghost" style={{ marginRight: "auto" }} onClick={onOpenLogFolder} disabled={controlsBusy}>
            로그 폴더 열기
          </Button>
          <Button onClick={onReset} disabled={controlsBusy}>
            기본값 복원
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={controlsBusy}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={controlsBusy || !canSubmit}>
            저장
          </Button>
        </>
      }
    >
        <section className="modal-section">
          <p className="muted-line modal-note">다음 번 번역 실행부터 적용됩니다.</p>
          <div className="settings-field-stack">
            <span>번역 엔진</span>
            <div className="settings-mode-group" role="tablist" aria-label="번역 엔진">
              {MODEL_PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-preset-button ${modelProvider === option.id ? "active" : ""}`}
                  onClick={() => {
                    clearTestState();
                    setModelProvider(option.id);
                  }}
                  disabled={controlsBusy}
                  aria-pressed={modelProvider === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="muted-line modal-note">
              {MODEL_PROVIDER_OPTIONS.find((option) => option.id === modelProvider)?.description}
            </p>
          </div>

          <label>
            최대 출력 토큰
            <input
              type="number"
              min={MIN_MAX_TOKENS}
              max={MAX_MAX_TOKENS}
              step={100}
              value={maxTokens}
              disabled={controlsBusy}
              onChange={(event) => {
                clearTestState();
                setMaxTokens(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submit();
                }
              }}
            />
          </label>
          <p className="muted-line modal-note">
            출력이 길어지는 페이지에서 말풍선 누락을 줄입니다. 기본값은 12000입니다.
          </p>

          <div className="settings-field-stack">
            <span>Paddle OCR 장치</span>
            <div className="settings-mode-group" role="tablist" aria-label="Paddle OCR 장치">
              {OCR_DEVICE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-preset-button ${ocrDevice === option.id ? "active" : ""}`}
                  onClick={() => {
                    clearTestState();
                    setOcrDevice(option.id);
                  }}
                  disabled={controlsBusy}
                  aria-pressed={ocrDevice === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="muted-line modal-note">
              {OCR_DEVICE_OPTIONS.find((option) => option.id === ocrDevice)?.description}
            </p>
          </div>

          <div className="settings-field-stack">
            <span>Paddle OCR 엔진</span>
            <div className="settings-mode-group" role="tablist" aria-label="Paddle OCR 엔진">
              {OCR_ENGINE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-preset-button ${ocrEngine === option.id ? "active" : ""}`}
                  onClick={() => {
                    clearTestState();
                    setOcrEngine(option.id);
                  }}
                  disabled={controlsBusy}
                  aria-pressed={ocrEngine === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="muted-line modal-note">
              {OCR_ENGINE_OPTIONS.find((option) => option.id === ocrEngine)?.description}
            </p>
          </div>

          <label>
            OCR batch size
            <input
              type="number"
              min={MIN_OCR_BATCH_SIZE}
              max={MAX_OCR_BATCH_SIZE}
              step={1}
              value={ocrBatchSize}
              disabled={controlsBusy}
              onChange={(event) => {
                clearTestState();
                setOcrBatchSize(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submit();
                }
              }}
            />
          </label>
          <p className="muted-line modal-note">
            PP-OCRv5에서 여러 페이지를 한 번에 예측합니다. PaddleOCR-VL은 안정성을 위해 순차 처리합니다. 기본값은 1입니다.
          </p>

          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={includeSoundEffects}
              disabled={controlsBusy}
              onChange={(event) => {
                clearTestState();
                setIncludeSoundEffects(event.target.checked);
              }}
            />
            <span>효과음/의성어 번역 포함</span>
          </label>

          <div className="settings-field-stack">
            <span>번역 방식</span>
            <div className="settings-mode-group" role="tablist" aria-label="번역 방식">
              {TRANSLATION_MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-preset-button ${translationMode === option.id ? "active" : ""}`}
                  onClick={() => {
                    clearTestState();
                    setTranslationMode(option.id);
                  }}
                  disabled={controlsBusy}
                  aria-pressed={translationMode === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="muted-line modal-note">
              {TRANSLATION_MODE_OPTIONS.find((option) => option.id === translationMode)?.description ??
                TRANSLATION_MODE_OPTIONS.find((option) => option.id === DEFAULT_TRANSLATION_MODE)?.description}
            </p>
          </div>

          <div className="settings-field-stack">
            <span>OCR bbox 후보 블록 확장</span>
            <div className="settings-number-grid">
              <label>
                가로 (%)
                <input
                  type="number"
                  min={MIN_OCR_BBOX_EXPAND_PERCENT}
                  max={MAX_OCR_BBOX_EXPAND_PERCENT}
                  step={1}
                  value={ocrBboxExpandXPercent}
                  disabled={controlsBusy}
                  onChange={(event) => {
                    clearTestState();
                    setOcrBboxExpandXPercent(event.target.value);
                  }}
                />
              </label>
              <label>
                세로 (%)
                <input
                  type="number"
                  min={MIN_OCR_BBOX_EXPAND_PERCENT}
                  max={MAX_OCR_BBOX_EXPAND_PERCENT}
                  step={1}
                  value={ocrBboxExpandYPercent}
                  disabled={controlsBusy}
                  onChange={(event) => {
                    clearTestState();
                    setOcrBboxExpandYPercent(event.target.value);
                  }}
                />
              </label>
            </div>
          </div>

          <label>
            텍스트 외곽선 두께 (px)
            <input
              type="number"
              min={MIN_TEXT_OUTLINE_WIDTH_PX}
              max={MAX_TEXT_OUTLINE_WIDTH_PX}
              step={0.1}
              value={textOutlineWidthPx}
              disabled={controlsBusy}
              onChange={(event) => {
                clearTestState();
                setTextOutlineWidthPx(event.target.value);
              }}
            />
          </label>

          {modelProvider === "gemma" ? (
            <>
          <div className="settings-field-stack">
            <span>모델 소스</span>
            <div className="settings-mode-group" role="tablist" aria-label="모델 소스">
              {MODEL_SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-preset-button ${modelSource === option.id ? "active" : ""}`}
                  onClick={() => {
                    clearTestState();
                    setModelSource(option.id);
                  }}
                  disabled={controlsBusy}
                  aria-pressed={modelSource === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="muted-line modal-note">
              {MODEL_SOURCE_OPTIONS.find((option) => option.id === modelSource)?.description}
            </p>
          </div>

          {modelSource === "huggingface" ? (
            <>
              <div className="settings-field-stack">
                <span>모델 / 실행 모드</span>
                <div className="settings-preset-group" role="tablist" aria-label="모델 프리셋">
                  {MODEL_PRESET_BUTTON_IDS.map((presetId) => (
                    <button
                      key={presetId}
                      type="button"
                      className={`settings-preset-button ${selectedPreset === presetId ? "active" : ""}`}
                      onClick={() => {
                        clearTestState();
                        setSelectedPreset(presetId);
                        if (presetId !== "custom") {
                          setCustomVramMode(MODEL_PRESETS[presetId].vramMode);
                        }
                      }}
                      disabled={controlsBusy}
                      aria-pressed={selectedPreset === presetId}
                    >
                      {presetId === "custom" ? "커스텀" : MODEL_PRESETS[presetId].label}
                    </button>
                  ))}
                </div>
                <p className="muted-line modal-note">
                  {selectedPreset === "custom"
                    ? "직접 지정한 모델을 사용합니다. 커스텀 모델은 현재 저장된 실행 설정을 유지합니다."
                    : MODEL_PRESETS[selectedPreset].description}
                </p>
              </div>
              {selectedPreset === "custom" ? (
                <>
                  <label>
                    저장된 커스텀
                    <select
                      value={selectedCustomPresetId}
                      disabled={controlsBusy || customModelPresets.length === 0}
                      onChange={(event) => {
                        clearTestState();
                        const presetId = event.target.value;
                        setSelectedCustomPresetId(presetId);
                        const preset = customModelPresets.find((candidate) => candidate.id === presetId);
                        if (preset) {
                          setCustomModelRepo(preset.modelRepo);
                          setCustomModelFile(preset.modelFile);
                        }
                      }}
                    >
                      <option value="">직접 입력</option>
                      {customModelPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    HF repo
                    <input
                      ref={modelRepoInputRef}
                      value={customModelRepo}
                      disabled={controlsBusy}
                      onChange={(event) => {
                        clearTestState();
                        setSelectedCustomPresetId("");
                        setCustomModelRepo(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submit();
                        }
                      }}
                    />
                  </label>
                  <label>
                    GGUF 파일명
                    <input
                      value={customModelFile}
                      disabled={controlsBusy}
                      onChange={(event) => {
                        clearTestState();
                        setSelectedCustomPresetId("");
                        setCustomModelFile(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submit();
                        }
                      }}
                    />
                  </label>
                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      onClick={saveCurrentCustomPreset}
                      disabled={controlsBusy || !customModelRepo.trim() || !customModelFile.trim()}
                    >
                      현재 커스텀 저장
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={deleteSelectedCustomPreset}
                      disabled={controlsBusy || !selectedCustomPresetId}
                    >
                      선택 항목 삭제
                    </button>
                  </div>
                  <p className="muted-line modal-note">
                    하단 저장 버튼을 누르면 현재 커스텀을 드롭다운 목록에도 함께 저장합니다.
                  </p>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="settings-field-stack">
                <span>로컬 모델 파일</span>
                <div className="settings-file-row">
                  <input
                    ref={localModelInputRef}
                    value={localModelPath}
                    disabled={controlsBusy}
                    onChange={(event) => {
                      clearTestState();
                      setLocalModelPath(event.target.value);
                    }}
                    placeholder="C:\\models\\my-model.gguf"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submit();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void pickLocalModelFile()} disabled={controlsBusy}>
                    파일 선택
                  </button>
                </div>
              </div>

              <div className="settings-field-stack">
                <span>mmproj 파일</span>
                <div className="settings-file-row">
                  <input
                    value={localMmprojPath}
                    disabled={controlsBusy}
                    onChange={(event) => {
                      clearTestState();
                      setLocalMmprojPath(event.target.value);
                    }}
                    placeholder="같은 폴더면 자동 탐지, 필요하면 직접 지정"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        submit();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void pickLocalMmprojFile()} disabled={controlsBusy}>
                    파일 선택
                  </button>
                </div>
                <p className="muted-line modal-note">
                  mmproj는 같은 폴더에서 자동으로 찾아보고, 안 잡히면 직접 지정할 수 있습니다.
                </p>
              </div>
            </>
          )}

            </>
          ) : (
            <>
              <label>
                Codex 모델
                <input
                  value={codexModel}
                  disabled={controlsBusy}
                  onChange={(event) => {
                    clearTestState();
                    setCodexModel(event.target.value);
                  }}
                  placeholder="gpt-5.5"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submit();
                    }
                  }}
                />
              </label>

              <div className="settings-field-stack">
                <span>생각</span>
                <div className="settings-preset-group" role="tablist" aria-label="Codex 생각">
                  {CODEX_REASONING_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`settings-preset-button ${codexReasoningEffort === option.id ? "active" : ""}`}
                      onClick={() => {
                        clearTestState();
                        setCodexReasoningEffort(option.id);
                      }}
                      disabled={controlsBusy}
                      aria-pressed={codexReasoningEffort === option.id}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="muted-line modal-note">
                  {CODEX_REASONING_OPTIONS.find((option) => option.id === codexReasoningEffort)?.description}
                </p>
              </div>

              <label>
                openai-oauth 포트
                <input
                  type="number"
                  min={0}
                  max={65535}
                  step={1}
                  value={codexOauthPort}
                  disabled={controlsBusy}
                  onChange={(event) => {
                    clearTestState();
                    setCodexOauthPort(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submit();
                    }
                  }}
                />
              </label>
            </>
          )}

          <div className="settings-field-stack">
            <span>모델 테스트</span>
            <div className="settings-inline-actions">
              <button
                type="button"
                onClick={() => void runModelTest()}
                disabled={controlsBusy || !canSubmit || jobActive}
              >
                {testState.status === "running" ? "테스트 중..." : "잘 작동되나 확인"}
              </button>
            </div>
            <p className="muted-line modal-note">
              서버가 뜨고 간단한 텍스트 요청에 응답하는지만 확인합니다. 실제 이미지 번역 가능 여부와는 다를 수 있습니다.
            </p>
            {jobActive ? <p className="muted-line">번역 작업 중에는 모델 테스트를 실행할 수 없습니다.</p> : null}
            {testState.status !== "idle" ? (
              <div className={`settings-test-result ${testState.status}`}>
                <strong>{testState.message}</strong>
                {testState.detail ? <p>{testState.detail}</p> : null}
              </div>
            ) : null}
            {testLogLines.length > 0 ? (
              <div className="settings-test-log" ref={testLogRef} aria-label="모델 테스트 로그">
                {testLogLines.map((line, index) => (
                  <code key={`${index}-${line}`}>{line}</code>
                ))}
              </div>
            ) : null}
          </div>

          {modelProvider === "openai-codex" && !codexOauthPortValid ? (
            <p className="muted-line">openai-oauth 포트는 0 이상 65535 이하의 정수여야 합니다.</p>
          ) : null}
          {!maxTokensValid ? (
            <p className="muted-line">최대 출력 토큰은 {MIN_MAX_TOKENS} 이상 {MAX_MAX_TOKENS} 이하의 정수여야 합니다.</p>
          ) : null}
          {!ocrBatchSizeValid ? (
            <p className="muted-line">
              OCR batch size는 {MIN_OCR_BATCH_SIZE} 이상 {MAX_OCR_BATCH_SIZE} 이하의 정수여야 합니다.
            </p>
          ) : null}
          {!ocrBboxExpandValid ? (
            <p className="muted-line">OCR bbox 확장 비율은 {MIN_OCR_BBOX_EXPAND_PERCENT}~{MAX_OCR_BBOX_EXPAND_PERCENT}% 사이여야 합니다.</p>
          ) : null}
          {!textOutlineWidthValid ? (
            <p className="muted-line">
              텍스트 외곽선 두께는 {MIN_TEXT_OUTLINE_WIDTH_PX}~{MAX_TEXT_OUTLINE_WIDTH_PX}px 사이여야 합니다.
            </p>
          ) : null}
        </section>
    </Modal>
  );
}

function resolveInitialCustomPresetId(
  presets: GemmaCustomModelPreset[],
  modelRepo: string,
  modelFile: string
): string {
  const matchingPreset = presets.find((preset) => sameCustomModelPreset(preset, modelRepo.trim(), modelFile.trim()));
  return matchingPreset?.id ?? "";
}

function normalizeCustomModelPresetsForSettings(presets: GemmaCustomModelPreset[]): GemmaCustomModelPreset[] {
  const seen = new Set<string>();
  return presets
    .map((preset) => ({
      ...preset,
      id: preset.id.trim(),
      label: preset.label.trim(),
      modelRepo: preset.modelRepo.trim(),
      modelFile: preset.modelFile.trim(),
      mmprojRepo: preset.mmprojRepo?.trim(),
      mmprojFile: preset.mmprojFile?.trim()
    }))
    .filter((preset) => {
      if (!preset.id || !preset.modelRepo || !preset.modelFile) {
        return false;
      }
      if (seen.has(preset.id)) {
        return false;
      }
      seen.add(preset.id);
      return true;
    })
    .map((preset) => ({
      id: preset.id,
      label: preset.label || buildCustomPresetLabel(preset.modelRepo, preset.modelFile),
      modelRepo: preset.modelRepo,
      modelFile: preset.modelFile,
      ...(preset.mmprojRepo ? { mmprojRepo: preset.mmprojRepo } : {}),
      ...(preset.mmprojFile ? { mmprojFile: preset.mmprojFile } : {}),
    }));
}

function sameCustomModelPreset(preset: GemmaCustomModelPreset, modelRepo: string, modelFile: string): boolean {
  return preset.modelRepo.trim() === modelRepo.trim() && preset.modelFile.trim() === modelFile.trim();
}

function createCustomPresetId(modelRepo: string, modelFile: string, presets: GemmaCustomModelPreset[]): string {
  const base = `${modelRepo}-${modelFile}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  const fallbackBase = base || `custom-${Date.now()}`;
  const usedIds = new Set(presets.map((preset) => preset.id));
  let candidate = fallbackBase;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${fallbackBase}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function buildCustomPresetLabel(modelRepo: string, modelFile: string): string {
  const repoName = modelRepo.split("/").filter(Boolean).pop() ?? modelRepo;
  const fileName = modelFile.replace(/\.gguf$/i, "");
  return `${repoName} / ${fileName}`.slice(0, 120);
}

function upsertCustomModelPreset(
  presets: GemmaCustomModelPreset[],
  nextPreset: GemmaCustomModelPreset
): GemmaCustomModelPreset[] {
  const existingIndex = presets.findIndex((preset) => preset.id === nextPreset.id);
  if (existingIndex < 0) {
    return [...presets, nextPreset];
  }
  return presets.map((preset, index) => (index === existingIndex ? nextPreset : preset));
}

function resolveTranslationMode(value: unknown): TranslationMode {
  return value === "image" || value === "ocr-text" || value === "ocr-text-with-image-retry"
    ? value
    : DEFAULT_TRANSLATION_MODE;
}

function isValidPercent(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_OCR_BBOX_EXPAND_PERCENT && value <= MAX_OCR_BBOX_EXPAND_PERCENT;
}

function ratioToPercentInput(value: unknown, fallbackPercent: number): string {
  const ratio = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ratio)) {
    return String(fallbackPercent);
  }
  return String(Math.round(ratio * 100));
}

function numberToInput(value: unknown, fallback: number): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : String(fallback);
}

function buildTestDetail(
  modelPath: string | null | undefined,
  mmprojPath: string | null | undefined,
  endpoint: string | null | undefined
): string | null {
  const lines = [
    modelPath ? `모델: ${modelPath}` : null,
    mmprojPath ? `mmproj: ${mmprojPath}` : null,
    endpoint ? `엔드포인트: ${endpoint}` : null
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : null;
}

function formatModelTestProgressLine(event: ModelTestProgressEvent): string {
  const percent =
    event.progressMode !== "log-only" && typeof event.progressPercent === "number" && Number.isFinite(event.progressPercent)
      ? `${Math.round(event.progressPercent * 100)}% `
      : "";
  if (event.installLogLine?.trim()) {
    return `${percent}${event.installLogLine.trim()}`;
  }
  const detail = event.detail?.trim();
  return detail ? `${percent}${event.progressText} - ${detail}` : `${percent}${event.progressText}`;
}

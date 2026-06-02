# 웹 페이지 번역 지원 기능 — 상세 구현 계획

> **문서 버전:** 0.1  
> **작성일:** 2026-06-02  
> **대상 코드베이스:** Gemma4MangaTranslatorForKorean (Electron + React)  
> **목적:** 현재 로컬 파일(이미지/폴더/ZIP) 전용인 앱에 **웹 페이지 기반 만화/웹툰 읽기 + OCR/번역** 기능을 추가하기 위한 설계·로드맵

---

## 1. 배경 및 목표

### 1.1 현재 상태

앱은 다음 흐름으로 동작한다.

```
로컬 파일/ZIP import → library/ 디스크 저장 → main OCR+Gemma 파이프라인 → renderer 오버레이 편집
```

- **입력:** 이미지 파일, 폴더, ZIP/CBZ (`ImportSourceKind`: `images | folder | zip | zip-folder`)
- **저장:** `library/works/{workId}/chapters/{chapterId}/pages/` 아래 PNG/WebP
- **표시:** `ImageStage` + `OverlayBlock` (정규화 bbox 오버레이)
- **번역:** `job:start-analysis` → `runWholePagePipeline` (화 단위 배치, `runMode`: `pending | all | single-page`)
- **제약:** 동시 active job 1개 (`ActiveJobStore`), 이미지는 `mgt-image://` 프로토콜 + library 샌드박스 내만 허용

웹 URL, 스크롤 뷰어, 실시간 페이지별 처리에 대한 코드는 **존재하지 않는다**.

### 1.2 추가하려는 기능

| 요구 | 설명 |
|------|------|
| **웹 페이지 입력** | URL을 열어 온라인 만화/웹툰 사이트에서 직접 작업 |
| **스크롤 대응** | 세로 스크롤(웹툰), 가로 페이지 넘김, 무한 스크롤 등 레이아웃별 캡처 |
| **실시간성** | 사용자가 읽는 속도에 맞춰 **한 페이지(뷰포트/세그먼트)씩** OCR → 번역 → 오버레이 표시 |
| **기존 UX 재사용** | 블록 편집, 저장, 공유(`.mgtshare`) 등 로컬 화와 동일한 데이터 모델 유지 |

### 1.3 비목표 (1차 릴리스)

- 웹사이트별 완전 자동 DOM 파싱(모든 사이트 범용 크롤러)
- 브라우저 확장 프로그램 단독 배포
- 웹 페이지 인페인팅(Flux) 실시간 연동 — 2차 이후 검토
- DRM/유료 구독 사이트 우회

---

## 2. 설계 원칙

1. **Library-first:** 웹에서 캡처한 이미지도 반드시 `library/` 아래 materialize한다. 기존 `assertLibraryImagePath`, `mgt-image://`, OCR/번역 파이프라인을 그대로 재사용한다.
2. **Main에서 캡처, Renderer에서 편집:** ML·네트워크·브라우저 엔진은 main process; renderer는 기존 `ChapterSnapshot` + `ImageStage` 유지.
3. **점진적 확장:** 1) URL + 수동 캡처 → 2) 스크롤 연동 → 3) 실시간 자동 번역 → 4) 사이트 프리셋 순으로 단계적 출시.
4. **실패 허용:** 사이트마다 DOM/이미지 로딩 방식이 다르므로, **범용 캡처(스크린샷)** 를 기본으로 하고 사이트별 어댑터는 옵션으로 추가한다.

---

## 3. 아키텍처 옵션 비교

### 옵션 A — Embedded Browser + 캡처 → Library (권장)

```
[BrowserView/WebContentsView]  ← main이 URL 로드
        │ capturePageSegment()
        ▼
[materializeWebPage] → library/pages/NNN.png
        │
        ▼
[runWholePagePipeline single-page] → blocks → renderer overlay
```

| 장점 | 단점 |
|------|------|
| 기존 library/OCR/번역 100% 재사용 | BrowserView UI/포커스/보안 설계 필요 |
| 로그인·쿠키·JS 렌더링 지원 | 캡처 해상도·스크롤 동기화 난이도 |
| Electron 네이티브 기능 활용 | 앱 창 레이아웃 변경 |

### 옵션 B — 외부 브라우저 + 확장/클립보드 수신

앱이 이미지 paste/DnD만 받고, 사용자는 Chrome 확장으로 캡처.

| 장점 | 단점 |
|------|------|
| 앱 변경 최소 | 별도 확장 배포·유지보수 |
| 사이트 호환성 높음 | 실시간 UX 끊김, 통합 UX 약함 |

### 옵션 C — URL에서 이미지 URL만 fetch (정적 갤러리형)

`<img src>` 목록을 추출해 HTTP 다운로드.

| 장점 | 단점 |
|------|------|
| 구현 단순 | Canvas/WebP blob, lazy load, DRM 사이트 불가 |
| | 스크롤형 웹툰 대응 불가 |

**결론: 옵션 A를 1차 목표로 채택.** 옵션 C는 특정 사이트 프리셋의 보조 수단으로 3차에 추가.

---

## 4. 목표 사용자 시나리오

### 시나리오 1 — 세로 스크롤 웹툰 (실시간)

1. 사용자가 `웹에서 열기` → URL 입력
2. 앱 하단/좌측에 브라우저 패널, 우측/상단에 번역 오버레이 패널 (split view)
3. 사용자가 스크롤 → **스크롤 정지 300ms 후** 현재 뷰포트 캡처
4. 캡처가 새 세그먼트면 library page 추가 + `single-page` 번역 job 자동 시작
5. 번역 완료 시 해당 세그먼트 위에 오버레이 표시 (읽으면서 아래로 스크롤)

### 시나리오 2 — 가로 페이지 넘김 (만화 뷰어)

1. 사이트의 `다음` 버튼 또는 ←/→ 키로 페이지 전환
2. 전환 감지 시 **전체 뷰포트** 또는 **`.viewer img` 영역** 캡처
3. chapter pageOrder에 순서대로 append + 번역

### 시나리오 3 — 배치 import (비실시간)

1. URL + "전체 캡처" 모드: 자동 스크롤하면서 N장 캡처 후 일괄 번역
2. 기존 `이어서 번역` / `전체 다시 번역` UX와 동일하게 동작

---

## 5. 데이터 모델 확장

### 5.1 ImportSourceKind 확장

```typescript
// src/shared/types.ts
export type ImportSourceKind =
  | "images" | "folder" | "zip" | "zip-folder"
  | "web";  // 신규

export type WebPageSourceMeta = {
  url: string;                    // 최초 진입 URL
  finalUrl?: string;              // 리다이렉트 후 URL
  segmentIndex: number;           // 0-based 캡처 순서
  scrollY?: number;               // 캡처 시 scrollY (중복 방지)
  viewport: { width: number; height: number; deviceScaleFactor: number };
  captureMode: "viewport" | "element" | "full-page";
  capturedAt: string;             // ISO timestamp
  contentHash?: string;           // perceptual hash / sha256 (중복 skip)
  sitePresetId?: string;          // 적용된 사이트 프리셋
};
```

### 5.2 LibraryPageRecord 확장 (선택 필드)

```typescript
export type LibraryPageRecord = Omit<MangaPage, "dataUrl"> & {
  webMeta?: WebPageSourceMeta;
};
```

- `imagePath`는 기존과 동일 (`pages/001-{id}.png`)
- 공유(`.mgtshare`) 시 `webMeta` 포함 여부는 설정으로 선택 (기본: URL만, 스크린샷은 항상 포함)

### 5.3 WebSession (main memory + optional disk)

브라우저 세션 상태. library chapter와 1:1 또는 N:1 매핑.

```typescript
export type WebBrowseSession = {
  sessionId: string;
  chapterId: string;              // materialize 대상 chapter
  browserViewId: string;
  startUrl: string;
  mode: "live" | "batch" | "manual";
  autoTranslate: boolean;
  lastCaptureHash?: string;
  lastScrollY?: number;
  segmentCount: number;
  createdAt: string;
};
```

저장 위치: `library/works/{workId}/chapters/{chapterId}/web-session.json` (앱 재시작 복원용)

### 5.4 Chapter 메타

```typescript
export type LibraryChapter = {
  // ...
  sourceKind: ImportSourceKind;   // "web"
  webOrigin?: {
    startUrl: string;
    title?: string;
    sitePresetId?: string;
  };
};
```

---

## 6. 핵심 모듈 설계

### 6.1 Main — `webBrowser/` (신규)

| 파일 | 책임 |
|------|------|
| `webBrowserManager.ts` | BrowserView/WebContentsView 생성·attach·destroy, 세션 CRUD |
| `webCapture.ts` | `captureViewport`, `captureElement`, `captureFullPage` (CDP `Page.captureScreenshot`) |
| `webScroll.ts` | 프로그래매틱 스크롤 (배치), scroll idle 감지 |
| `webSitePresets.ts` | 사이트별 selector, scroll step, next button (optional) |
| `webMaterialize.ts` | 캡처 Buffer → `materializePageRecord` 래퍼 |
| `webSessionStore.ts` | 세션 영속화, TTL, 중복 hash 관리 |

**BrowserView 배치 (Electron 39 기준):**

- `WebContentsView` 우선 검토 (최신 API, BrowserView deprecated 추세)
- Main window content 영역에 attach; renderer React와 **별도 native view**이므로 bounds는 IPC로 동기화

### 6.2 Main — `library.ts` 확장

```typescript
async function materializeWebCapture(input: {
  chapterId: string;
  imageBuffer: Buffer;
  webMeta: WebPageSourceMeta;
  pageName?: string;
}): Promise<LibraryPageRecord>
```

- 기존 `materializePageRecord` 패턴 재사용 (PNG write, width/height probe)
- `pageOrder` append + `chapter.json` atomic update (`AsyncMutex`)

### 6.3 Main — 실시간 번역 오케스트레이션

현재 `ActiveJobStore`는 **동시 1 job**. 실시간 모드 대응:

| 전략 | 설명 | 권장 |
|------|------|------|
| **Queue + coalesce** | 새 캡처마다 queue에 넣되, 처리 중이면 최신 1건만 유지 | 1차 |
| **Dedicated live job** | `kind: "web-live-analysis"` 별도, 내부에서 single-page 연속 처리 | 2차 |
| **Cancel & restart** | 스크롤마다 이전 job cancel → 새 page | UX 나쁨, 비권장 |

**1차 구현 (Queue):**

```
capture → enqueue(pageId)
worker: while queue not empty
  dequeue → runWholePagePipeline([single page])
  emit job:event → renderer refresh page blocks
```

- `runMode: "single-page"` + `pageId` 기존 API 재사용
- OCR hints 캐시: `runs/{jobId}/ocr-hints-{pageId}.json` (페이지별)

**프리페치 (2차):**

- 현재 페이지 번역 중, **다음 viewport 캡처만** 미리 materialize (번역은 하지 않음)
- 사용자가 스크롤 시 대기 시간 단축

### 6.4 Renderer — UI 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `WebBrowseModal` / `WebBrowsePanel` | URL 입력, 모드 선택 (실시간/수동/배치) |
| `WebBrowseLayout` | Split: browser bounds + overlay stage |
| `WebBrowseToolbar` | 캡처, 자동번역 토글, 스크롤 step, 사이트 프리셋 |
| `WebLiveStatusBar` | 현재 segment, queue depth, 번역 중 표시 |

**기존 재사용:**

- `ImageStage`, `OverlayBlock`, `EditorPanel`, `useChapterPersistence`
- `useJobEvents` — web live job도 `job:event` 동일 채널
- `pageNavigation.ts` — web segment ↔ pageOrder 매핑 시 `resolveAdjacentPageId` 재사용

### 6.5 Browser bounds 동기화

Renderer resize/layout 변경 시 main BrowserView bounds 업데이트:

```
renderer: ResizeObserver → IPC web:sync-bounds { x, y, width, height }
main: webBrowserManager.setBounds(sessionId, rect)
```

- DPI scaling: `deviceScaleFactor` 반영
- DevTools/모달 열림 시 browser panel hide 또는 bounds 0

---

## 7. IPC 설계

### 7.1 Preload API (`mangaApi` 확장)

| 메서드 | 설명 |
|--------|------|
| `openWebBrowse(request)` | URL + mode → sessionId, chapterId, openedChapter 반환 |
| `closeWebBrowse(sessionId)` | BrowserView destroy, 세션 정리 |
| `captureWebSegment(sessionId, options?)` | 수동 캡처 → pageId |
| `setWebAutoTranslate(sessionId, enabled)` | 실시간 토글 |
| `syncWebBrowserBounds(sessionId, rect)` | layout sync |
| `scrollWebBrowser(sessionId, deltaY)` | 프로그래매틱 스croll (배치용) |
| `getWebBrowseState(sessionId)` | segmentCount, queue, currentUrl |

### 7.2 Push 이벤트

| 채널 | payload |
|------|---------|
| `web:segment-captured` | `{ sessionId, pageId, segmentIndex, thumbnailUrl? }` |
| `web:navigation` | `{ sessionId, url, title }` |
| `web:scroll-idle` | `{ sessionId, scrollY }` — live mode 트리거 |
| `job:event` | 기존과 동일 (pageIndex, phase 등) |

### 7.3 Zod 스키마

`src/shared/ipcSchemas.ts`에 `OpenWebBrowseRequestSchema`, `WebBrowseBoundsSchema` 추가.

---

## 8. 스크롤·페이지 넘김 대응 상세

### 8.1 캡처 모드

| 모드 | API | 용도 |
|------|-----|------|
| **viewport** | CDP screenshot (clip 없음) | 기본, 대부분 웹툰 |
| **element** | selector bounding box clip | `.viewer`, `#content` 등 |
| **full-page** | CDP full page | 배치 import, 짧은 페이지 |

### 8.2 중복 방지

스크롤 bounce/미세 움직임으로 동일 화면이 여러 번 캡처되는 것 방지:

1. `scroll idle` debounce 300–500ms
2. `scrollY` 변화량 < viewport 높이의 15% → skip
3. 캡처 이미지 **dHash/perceptual hash** — 이전 hash와 Hamming distance < threshold → skip
4. (옵션) 사이트 프리셋 `minScrollStepPx`

### 8.3 세로 스크롤 웹툰 (live)

```mermaid
sequenceDiagram
  participant U as User
  participant B as BrowserView
  participant M as Main webBrowser
  participant L as library
  participant P as wholePagePipeline

  U->>B: scroll
  B->>M: did-scroll / scroll-idle
  M->>M: dedupe check
  M->>B: captureViewport
  M->>L: materializeWebCapture
  M->>P: enqueue single-page analysis
  P->>L: updatePageAfterAnalysis
  P-->>Renderer: job:event page_complete
  Renderer->>Renderer: overlay refresh
```

### 8.4 가로 페이지 넘김

1. **프리셋 방식:** `nextButtonSelector` 클릭 감지 (`dom-ready` + mutation observer via preload script injection — **주의: isolated world**)
2. **범용 방식:** 사용자 `→` 키 또는 toolbar `다음 페이지 캡처` 버튼
3. **CDP `Page.getLayoutMetrics`** 로 scroll width 변화 감지 (가로 스크롤 사이트)

**Preload injection 대안 (보안):**

- BrowserView 전용 **preload script** (`web-browser-preload.js`): scroll/click 이벤트만 main으로 postMessage
- `contextIsolation: true` 유지, nodeIntegration false

### 8.5 배치 자동 스크롤

```
while segmentCount < maxSegments:
  capture → materialize
  scrollBy(viewportHeight * 0.9)
  wait scroll idle + image lazy-load delay (sitePreset.imageLoadWaitMs)
```

- lazy-load: `networkIdle` 또는 preset wait
- 최대 segment 수·최대 chapter page 수 cap (예: 500)

---

## 9. 실시간 번역 UX

### 9.1 상태 머신 (Web Live Session)

```
idle → browsing → capturing → queued → translating → overlay_ready → browsing
                      ↑___________________________________|
```

### 9.2 UI 표시

| 상태 | 사용자 피드백 |
|------|----------------|
| capturing | browser panel 하단 얇은 progress |
| translating | overlay panel에 skeleton / "번역 중…" |
| overlay_ready | 기존 `ImageStage` 오버레이 (browser 위가 아닌 **캡처본** 위) |
| failed | page `lastError` + 재시도 버튼 |

### 9.3 Split View 레이아웃 (권장)

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: URL | 실시간 ON/OFF | 캡처 | ← segment →      │
├──────────────────────────┬──────────────────────────────┤
│                          │                              │
│   BrowserView (원본)      │   ImageStage (캡처 + overlay) │
│   사용자가 스크롤/읽기      │   번역 결과 확인·편집          │
│                          │                              │
└──────────────────────────┴──────────────────────────────┘
```

- **왼쪽:** live web (스크롤)
- **오른쪽:** 마지막 캡처 segment의 번역 결과 (또는 segment 선택 시 해당 page)

대안: **오버레이-only 모드** — browser fullscreen + 캡처본을 반투명 overlay로 browser 위에 absolute (기술 난이도 높음, 2차)

### 9.4 segment ↔ page 선택 동기화

- `selectedPageId` 변경 시 오른쪽 `ImageStage` 전환
- browser scroll position을 과거 segment로 **되돌리기**는 optional (scroll restore는 2차)

---

## 10. 사이트 프리셋 (3차)

`webSitePresets.ts` 예시:

```typescript
export type WebSitePreset = {
  id: string;
  label: string;
  urlPattern: RegExp;
  viewerSelector?: string;
  nextButtonSelector?: string;
  scrollDirection: "vertical" | "horizontal";
  imageLoadWaitMs: number;
  captureMode: "viewport" | "element";
  batchScrollStepRatio: number;  // 0.9 = 90% viewport
};
```

초기 내장 프리셋 후보 (사용자 요청·테스트 기반):

- 일반 이미지 태그 나열형
- 세로 스크롤 웹툰 (연속 canvas/img)
- 가로 페이지 (single image viewer)

**범용 default preset** 1개만으로 1·2차 릴리스 가능.

---

## 11. 보안·정책

### 11.1 BrowserView 보안

- `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`
- `webSecurity: true` (기본)
- 허용 URL: 사용자 입력 + optional allowlist 설정
- `will-navigate` / `setWindowOpenHandler` 로 의도치 않은 팝업 제어

### 11.2 Renderer CSP

현재 `index.html` CSP는 `img-src 'self' data: blob: file: mgt-image:`.

- BrowserView는 **별도 webContents** → 앱 CSP와 분리 (외부 사이트 로드 가능)
- 캡처 결과는 library materialize → `mgt-image://` (변경 불필요)

### 11.3 법적·윤리 고지

- UI에 **"저작권이 있는 콘텐츠의 무단 복제·배포 금지"** 고지
- `.mgtshare` export 시 web URL 메타 포함 여부 경고
- 앱은 **개인 감상용 번역 오버레이** 목적 유지 (README 비목표와 일치)

---

## 12. 기존 코드 영향도

| 영역 | 변경 수준 | 내용 |
|------|-----------|------|
| `src/shared/types.ts` | 중 | `ImportSourceKind`, `webMeta`, WebSession 타입 |
| `src/shared/ipcSchemas.ts` | 중 | web IPC 스키마 |
| `src/main/library.ts` | 중 | `materializeWebCapture`, chapter web origin |
| `src/main/ipc/` | 대 | `webBrowseIpc.ts` 신규, `registerIpc.ts` |
| `src/main/wholePagePipeline.ts` | 소 | single-page queue 호출 (기존 로직 재사용) |
| `src/preload/index.ts` | 중 | mangaApi web 메서드 |
| `src/renderer/App.tsx` | 중 | web session state, layout mode |
| `src/renderer/components/` | 대 | WebBrowse* 컴포넌트 |
| `ImageStage`, `OverlayBlock` | **없음~소** | 재사용 |
| `translationJobIpc.ts` | 소 | live queue wrapper (optional) |
| `electron-builder.config.cjs` | 소 | web preload 번들 포함 |

---

## 13. 구현 단계 (로드맵)

### Phase 0 — 사전 작업 (1주)

- [ ] BrowserView/WebContentsView POC: URL 로드 + CDP screenshot
- [ ] `materializeWebCapture` prototype + library page append
- [ ] Split layout bounds sync POC
- [ ] scroll idle debounce + hash dedupe prototype

**완료 기준:** 임의 URL에서 수동 버튼 1회 → library page 생성 → 기존 `single-page` 번역 → overlay 표시

### Phase 1 — MVP: 수동 웹 캡처 (2–3주)

- [ ] `WebBrowseModal`: URL 입력 → web chapter 생성
- [ ] Toolbar `지금 화면 캡처` → materialize + `job:start-analysis` single-page
- [ ] Split view (browser + ImageStage)
- [ ] Library tree에 `sourceKind: web` 아이콘/표시
- [ ] 세션 종료·재열기 (web-session.json)
- [ ] IPC + 스키마 + 테스트 (materialize, dedupe)

**완료 기준:** 사용자가 웹툰 URL을 열고, 스크롤 후 수동 캡처·번역·편집·저장 가능

### Phase 2 — 스크롤 연동 + 준실시간 (2–3주)

- [ ] scroll idle 자동 캡처
- [ ] Live queue worker (single active translation, FIFO)
- [ ] `web:segment-captured` / job event 연동 UI
- [ ] segment 목록 (PageList 연동 또는 web segment strip)
- [ ] 배치 auto-scroll 캡처 (max cap)
- [ ] 프리페치 (capture only, no translate)

**완료 기준:** 세로 스크롤 웹툰을 읽으며 자동으로 segment 추가 + 번역 overlay 갱신

### Phase 3 — 페이지 넘김·프리셋 (2주)

- [ ] 가로 페이지 모드 (키/button)
- [ ] `webSitePresets` 2–3종
- [ ] 프리셋 UI (URL 매칭 자동 제안)
- [ ] element capture mode

### Phase 4 — 안정화·문서 (1–2주)

- [ ] 에러 복구 (capture fail, translation fail retry)
- [ ] 성능 (캡처 JPEG quality, max dimension downscale)
- [ ] README / 사용자 가이드
- [ ] `.mgtshare` webMeta 정책
- [ ] E2E smoke: mock HTML fixture server

---

## 14. 성능·품질 목표

| 항목 | 목표 |
|------|------|
| 캡처 지연 | scroll idle 후 **< 200ms** (screenshot only) |
| 번역 지연 | single-page OCR+Gemma **사용자 PC 기준** (기존과 동일, 진행 UI 필수) |
| 캡처 해상도 | 기본 viewport DPR cap (예: max 2000px 긴 변) — OCR 품질 vs 속도 |
| 중복 캡처율 | 동일 viewport **< 5%** (hash dedupe) |
| 메모리 | BrowserView 1개 + 세션당 캡처 buffer 즉시 disk flush |

---

## 15. 테스트 전략

### 15.1 Unit

- `webCapture` hash dedupe
- `webScroll` idle detection
- `materializeWebCapture` library path/assert
- IPC schema validation

### 15.2 Integration

- 로컬 static HTML fixture (`tests/fixtures/webtoon-scroll.html`) + Electron test
- capture → materialize → `runWholePagePipeline` mock runtime

### 15.3 Manual QA

- 세로 스크롤 긴 페이지 (lazy images)
- 가로 `←/→` 뷰어
- 로그인 필요 사이트 (쿠키 유지)
- 실시간 ON/OFF 전환
- job cancel during live translate

---

## 16. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| BrowserView + React layout sync 버그 | UI 깨짐 | bounds IPC + 단위 테스트, fullscreen fallback |
| Canvas/WebGL 만화 | 검은 캡처 | element capture, preset, 사용자 안내 |
| lazy-load 이미지 미로드 | 빈 캡처 | idle + networkIdle + preset wait |
| active job 1개 제한 | live backlog | queue + UI queue depth, skip stale |
| 사이트 ToS/DRM | 법적 | 고지, 개인용, 우회 기능 미제공 |
| 고해상도 캡처 OCR 느림 | 실시간성 저하 | downscale option, economy VRAM |
| BrowserView deprecated | 유지보수 | WebContentsView API 우선 사용 |

---

## 17. open questions (구현 전 결정 필요)

1. **레이아웃:** Split(browser+stage) vs Browser-only + floating overlay — **Split 권장**
2. **Chapter 생성 시점:** URL 입력 즉시 vs 첫 캡처 시 — **URL 입력 즉시** (빈 chapter + web origin meta)
3. **Work 이름:** URL title 자동 vs 사용자 입력 — **document.title + 편집 가능**
4. **실시간 기본값:** ON vs OFF — **OFF (MVP), Phase 2에서 ON 옵션**
5. **인페인팅:** web chapter 지원 여부 — **1차 제외**, 캡처본 기준 동일 pipeline 가능하나 UX 별도 검토
6. **Codex vs Gemma:** web live에서 Codex latency — 설정 따름, UI에 예상 대기 표시

---

## 18. 참고 — 재사용할 기존 API

```typescript
// 단일 페이지 번역 (이미 존재)
job:start-analysis {
  chapterId: string;
  runMode: "single-page";
  pageId: string;
}

// 페이지 이미지 표시
library:get-page-image-data-url(chapterId, pageId) → mgt-image://

// 블록 저장
library:save-page-blocks(chapterId, pageId, blocks)

// 페이지 네비게이션
resolveAdjacentPageId(pageOrder, selectedPageId, direction)
```

---

## 19. 요약

웹 페이지 지원은 **"URL 브라우저 + viewport 캡처 → 기존 library page → 기존 OCR/번역 pipeline"** 로 구현하는 것이 가장 안전하고 빠르다. 스크롤·페이지 넘김은 **scroll idle 감지 + hash dedupe + (optional) 사이트 프리셋**으로 해결하고, 실시간성은 **`single-page` 번역 queue** 로 기존 `ActiveJobStore` 제약 안에서 점진적으로 달성한다.

**Phase 0–1 (수동 캡처 MVP)** 를 먼저 완료한 뒤, Phase 2에서 live auto-translate를 켜는 순서를 권장한다.

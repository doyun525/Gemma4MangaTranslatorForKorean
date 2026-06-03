import type { IpcContext } from "./context";
import { registerFontsIpc } from "./fontsIpc";
import { registerImportShareIpc } from "./importShareIpc";
import { registerInpaintingIpc } from "./inpaintingIpc";
import { registerJobControlIpc } from "./jobControlIpc";
import { registerLibraryIpc } from "./libraryIpc";
import { registerLogsIpc } from "./logsIpc";
import { registerPageExportIpc } from "./pageExportIpc";
import { registerSettingsIpc } from "./settingsIpc";
import { registerTranslationJobIpc } from "./translationJobIpc";
import { registerWebBrowseIpc } from "./webBrowseIpc";

export function registerIpc(context: IpcContext): void {
  registerLogsIpc();
  registerSettingsIpc(context);
  registerLibraryIpc();
  registerFontsIpc(context);
  registerImportShareIpc(context);
  registerTranslationJobIpc(context);
  registerInpaintingIpc(context);
  registerPageExportIpc(context);
  registerJobControlIpc(context);
  registerWebBrowseIpc(context);
}

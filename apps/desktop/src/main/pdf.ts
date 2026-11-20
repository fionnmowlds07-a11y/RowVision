import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, session } from "electron";

/** Far more than any report needs: an eight with forty strokes is about 60 MB of pictures. */
export const MOST_BYTES = 400 * 1024 * 1024;

/** A file name the save box can offer, from what the page suggests. */
export function pdfName(suggested: unknown): string {
  const plain = typeof suggested === "string" ? suggested.replace(/[^\w .,()-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return `${plain.replace(/\.pdf$/i, "") || "RowVision report"}.pdf`;
}

/**
 * Turns the report page into a PDF. It is drawn in a hidden window of its own: no script, no bridge,
 * and nothing loaded but the one report file and the pictures and fonts written into it.
 */
export async function printReport(html: string): Promise<Buffer> {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "rowvision-report-"));
  const file = path.join(folder, "report.html");
  await fs.writeFile(file, html, "utf8");
  const page = pathToFileURL(file).href;
  const own = session.fromPartition("rowvision-report");
  own.webRequest.onBeforeRequest((details, reply) => reply({ cancel: !(details.url === page || details.url.startsWith("data:")) }));
  own.setPermissionRequestHandler((_, __, reply) => reply(false));
  const window = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { session: own, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  try {
    await window.loadURL(page);
    return await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    window.destroy();
    await fs.rm(folder, { recursive: true, force: true });
  }
}

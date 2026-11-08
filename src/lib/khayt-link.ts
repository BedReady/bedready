// "Send to Khayt" on the done screen: a khayt://job/new link that opens a new job in Khayt for Mac
// (beta.30+) from the file this page just downloaded.
//
// The shape is the Mac's, agreed with the Mac lane on 2026-11-08 and not ours to extend:
//
//     khayt://job/new?name=<title>&file=<plain filename .3mf|.stl|.obj|.gcode>&sha256=<64 hex>
//
// Nothing else rides along — printer, plates, swaps and filaments are read by the Mac from the 3MF
// itself. The Mac finds the file by its hash in the user's library or Downloads (so a browser
// renaming it "x (1).3mf" does not matter) and asks before creating the job; if the file is not
// there it says so and asks for a re-download or a drag-in.

/** Lower-case hex SHA-256 of the bytes, via WebCrypto (the page is a secure context). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The job title: the file name without `.3mf` and without the converter's own suffix. */
export function khaytJobTitle(fileName: string): string {
  const bare = fileName.replace(/\.3mf$/i, "").replace(/\.(u1|generic|import)$/i, "");
  return bare.trim() || fileName;
}

/** The link, or null when the inputs are not ones the Mac accepts. */
export function khaytJobLink(fileName: string, sha256: string): string | null {
  // Plain filename only: no path separators, and one of the extensions the Mac reads.
  if (!fileName || /[\\/]/.test(fileName) || !/\.(3mf|stl|obj|gcode)$/i.test(fileName)) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const q = (s: string) => encodeURIComponent(s);
  return `khayt://job/new?name=${q(khaytJobTitle(fileName))}&file=${q(fileName)}&sha256=${sha256}`;
}

/**
 * Khayt has a Mac app only (macOS 26+), so the button shows on a Mac and nowhere else. An iPad
 * reports "Macintosh" in desktop mode, which is why touch points rule it out.
 */
export function isMacDesktop(userAgent: string, maxTouchPoints: number): boolean {
  return /Macintosh|Mac OS X/.test(userAgent) && !/iPhone|iPad|iPod/.test(userAgent) && maxTouchPoints <= 1;
}

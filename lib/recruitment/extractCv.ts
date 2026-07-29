const MAX_PAGES = 8;
const MAX_CHARS = 24_000;
// Below this the CV is treated as a scan and pages are rasterized for the model.
const SCANNED_TEXT_THRESHOLD = 200;
const RASTER_TARGET_WIDTH = 1400; // px
const RASTER_MAX_PAGES = 4;
const RASTER_MAX_BYTES = 3_000_000;

export interface ExtractedCv {
  text: string;
  images: { buffer: Buffer; mediaType: "image/png" }[];
}

export async function extractCv(buffer: Buffer): Promise<ExtractedCv> {
  const mupdf: any = await import("mupdf");
  const doc = mupdf.Document.openDocument(new Uint8Array(buffer), "application/pdf");
  const total = Math.min(doc.countPages(), MAX_PAGES);

  let text = "";
  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i);
    try {
      text += (page.toStructuredText("preserve-whitespace").asText() || "") + "\n";
    } catch {
      /* no text layer on this page */
    }
  }
  text = text.trim().slice(0, MAX_CHARS);

  const images: ExtractedCv["images"] = [];
  if (text.length < SCANNED_TEXT_THRESHOLD) {
    for (let i = 0; i < Math.min(total, RASTER_MAX_PAGES); i++) {
      const page = doc.loadPage(i);
      const bounds = page.getBounds();
      const ptWidth = Math.max(1, bounds[2] - bounds[0]);
      const scale = Math.min(3, Math.max(1, RASTER_TARGET_WIDTH / ptWidth));
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      const png = Buffer.from(pix.asPNG());
      pix.destroy?.();
      if (png.length < 1024 || png.length > RASTER_MAX_BYTES) continue;
      images.push({ buffer: png, mediaType: "image/png" });
    }
  }
  return { text, images };
}

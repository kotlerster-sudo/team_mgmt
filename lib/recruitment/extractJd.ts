/**
 * JD document extractor — reads a JD out of a PDF, DOCX, or image screenshot
 * into `{ text, images }` shaped for a Claude message. Mirrors extractCv.ts:
 * PDFs go through mupdf (text layer if present, page rasters otherwise); DOCX
 * uses mammoth's raw-text extractor; images pass straight through so Claude
 * can read them as image blocks.
 */

const MAX_PAGES = 8;
const MAX_CHARS = 30_000;
const SCANNED_TEXT_THRESHOLD = 200; // below this, treat the PDF as scanned and rasterize
const RASTER_TARGET_WIDTH = 1400;
const RASTER_MAX_PAGES = 4;
const RASTER_MAX_BYTES = 3_000_000;

export type JdImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface ExtractedJd {
  text: string;
  images: { buffer: Buffer; mediaType: JdImageMediaType }[];
}

export async function extractJd(buffer: Buffer, mediaType: string): Promise<ExtractedJd> {
  const mt = mediaType.toLowerCase();
  if (mt === "application/pdf") return extractPdf(buffer);
  if (
    mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mt === "application/msword"
  ) {
    return extractDocx(buffer);
  }
  if (mt === "image/png" || mt === "image/jpeg" || mt === "image/webp") {
    return { text: "", images: [{ buffer, mediaType: mt }] };
  }
  throw new Error(`Unsupported JD type: ${mediaType}`);
}

async function extractPdf(buffer: Buffer): Promise<ExtractedJd> {
  const mupdf: unknown = await import("mupdf");
  // mupdf's TS types are loose; cast to any at the boundary and back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mupdf as any;
  const doc = m.Document.openDocument(new Uint8Array(buffer), "application/pdf");
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

  const images: ExtractedJd["images"] = [];
  if (text.length < SCANNED_TEXT_THRESHOLD) {
    for (let i = 0; i < Math.min(total, RASTER_MAX_PAGES); i++) {
      const page = doc.loadPage(i);
      const bounds = page.getBounds();
      const ptWidth = Math.max(1, bounds[2] - bounds[0]);
      const scale = Math.min(3, Math.max(1, RASTER_TARGET_WIDTH / ptWidth));
      const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
      const png = Buffer.from(pix.asPNG());
      pix.destroy?.();
      if (png.length < 1024 || png.length > RASTER_MAX_BYTES) continue;
      images.push({ buffer: png, mediaType: "image/png" });
    }
  }
  return { text, images };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedJd> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value.trim().slice(0, MAX_CHARS), images: [] };
}

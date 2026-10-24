// Browser-only extraction of plain text from PDF, Word (.docx) and PowerPoint (.pptx) files.
const MAX_CHARS = 200_000;
const MAX_IMAGES = 12;

async function toJpeg(src: Blob | HTMLCanvasElement, max = 1280): Promise<string | null> {
  try {
    const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
    if (bmp.width < 48 || bmp.height < 48) return null; // skip icons/bullets
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch { return null; }
}

/** Embedded pictures from a .docx/.pptx media folder (formats the browser can decode). */
async function zipImages(buf: ArrayBuffer, folder: string): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const num = (n: string) => Number(/(\d+)\.\w+$/.exec(n)?.[1] ?? 0);
  const names = Object.keys(zip.files).filter((n) => n.startsWith(folder) && /\.(png|jpe?g|gif|bmp|webp)$/i.test(n)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const n of names) {
    if (out.length >= MAX_IMAGES) break;
    const url = await toJpeg(await zip.file(n)!.async("blob"));
    if (url) out.push(url);
  }
  return out;
}

/** Render PDF pages that contain pictures, so the model sees charts, photos and diagrams. */
async function pdfImages(buf: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages && out.length < MAX_IMAGES; i++) {
    const page = await doc.getPage(i);
    const ops = await page.getOperatorList();
    const O = pdfjs.OPS;
    const hasImg = ops.fnArray.some((f) => f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageMaskXObject);
    if (!hasImg) continue;
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, 1280 / Math.max(vp0.width, vp0.height)) });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never).promise;
    const url = await toJpeg(c);
    if (url) out.push(url);
  }
  return out;
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = "";
    for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
      line += (it.str ?? "") + (it.hasEOL ? "\n" : "");
    }
    pages.push(`--- Page ${i} ---\n${line.trim()}`);
  }
  return pages.join("\n\n");
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ arrayBuffer: buf });
  return r.value;
}

function xmlText(xml: string, para: string): string {
  const d = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(d.getElementsByTagName(para))
    .map((p) => Array.from(p.getElementsByTagName("a:t")).map((t) => t.textContent ?? "").join(""))
    .filter((s) => s.trim())
    .join("\n");
}

async function pptxText(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const out: string[] = [];
  for (const s of slides) {
    let text = xmlText(await zip.file(s)!.async("string"), "a:p");
    const notes = zip.file(`ppt/notesSlides/notesSlide${num(s)}.xml`);
    if (notes) {
      const n = xmlText(await notes.async("string"), "a:p");
      if (n) text += `\n[Speaker notes]\n${n}`;
    }
    out.push(`--- Slide ${num(s)} ---\n${text}`);
  }
  return out.join("\n\n");
}

export function isParsableDoc(file: File) {
  return /\.(pdf|docx|pptx)$/i.test(file.name);
}

export async function parseDocument(file: File): Promise<{ text: string; images: string[] }> {
  if (file.size > 30_000_000) throw new Error(`${file.name} is larger than 30 MB`);
  const buf = await file.arrayBuffer();
  const ext = file.name.split(".").pop()!.toLowerCase();
  let text = "";
  let images: string[] = [];
  try {
    text = ext === "pdf" ? await pdfText(buf.slice(0)) : ext === "docx" ? await docxText(buf.slice(0)) : await pptxText(buf.slice(0));
  } catch {
    throw new Error(`${file.name} could not be read`);
  }
  try {
    images = ext === "pdf" ? await pdfImages(buf.slice(0)) : await zipImages(buf, ext === "docx" ? "word/media/" : "ppt/media/");
  } catch { images = []; }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text && !images.length) throw new Error(`${file.name} has no readable text or images`);
  if (!text) text = "[No text — see attached page images]";
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n[…truncated]";
  return { text, images };
}

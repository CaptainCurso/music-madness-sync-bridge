import path from "node:path";

const MEDIA_REGEX = /(?:src|href)=["']([^"']+)["']/gi;

export function extractMediaUrls(html: string): string[] {
  const urls = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = MEDIA_REGEX.exec(html)) !== null) {
    const value = match[1];
    if (!value) continue;
    if (value.startsWith("data:")) continue;
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) continue;
    urls.add(value);
  }

  return [...urls];
}

export function extensionFromMimeOrName(mimeType?: string, filename?: string): string {
  if (filename && filename.includes(".")) {
    return filename.split(".").pop()!.toLowerCase();
  }

  if (!mimeType) return "bin";
  const mime = mimeType.toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("svg")) return "svg";
  if (mime.includes("pdf")) return "pdf";
  return "bin";
}

export function filenameFromUrl(url: string): string {
  const clean = url.split("?")[0] ?? url;
  return path.basename(clean);
}

import { promises as fs } from "node:fs";
import path from "node:path";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// 本機 public/ 底下的圖片（路徑以 / 開頭），讀檔轉 base64 供 Gemini 使用
export async function loadLocalPublicImage(
  imageUrl: string
): Promise<{ data: string; mimeType: string } | null> {
  if (!imageUrl.startsWith("/") || imageUrl.startsWith("//")) return null;
  const relativePath = decodeURIComponent(imageUrl.split(/[?#]/)[0] ?? "");
  const mimeType = IMAGE_MIME_BY_EXT[path.extname(relativePath).toLowerCase()];
  if (!mimeType) return null;

  const publicDir = path.join(process.cwd(), "public");
  const resolved = path.resolve(publicDir, `.${relativePath}`);
  if (!resolved.startsWith(publicDir + path.sep)) return null;

  try {
    const buffer = await fs.readFile(resolved);
    return { data: buffer.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

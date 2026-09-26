// Browser-side prep for screenshots attached to support chats: shrink big
// images so uploads stay small, and hand back a data URL the server accepts.

const MAX_DIMENSION = 1800;
const KEEP_ORIGINAL_BYTES = 900 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export type PreparedImage = { dataUrl: string; bytes: number };

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the picture"));
    reader.readAsDataURL(blob);
  });
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Only pictures can be attached.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That picture couldn't be opened.");
  });
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && ACCEPTED.includes(file.type) && file.size <= KEEP_ORIGINAL_BYTES) {
      return { dataUrl: await readAsDataUrl(file), bytes: file.size };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That picture couldn't be processed.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob) throw new Error("That picture couldn't be processed.");
    return { dataUrl: await readAsDataUrl(blob), bytes: blob.size };
  } finally {
    bitmap.close();
  }
}

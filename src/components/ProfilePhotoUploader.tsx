import { useEffect, useRef, useState } from "react";
import { UserRound, ZoomIn, ZoomOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const OUTPUT_SIZE = 512;
const PREVIEW_SIZE = 280;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Point = { x: number; y: number };

async function readUploadResponse(
  response: Response,
): Promise<{ photoUrl?: string; error?: string }> {
  const body = await response.text();
  if (body) {
    try {
      return JSON.parse(body) as { photoUrl?: string; error?: string };
    } catch {
      // A proxy or server-level failure may return HTML instead of JSON.
    }
  }
  if (!response.ok) {
    return {
      error: `Picture upload failed (server returned ${response.status}). Refresh the page and try again.`,
    };
  }
  return {};
}

export function ProfilePhotoUploader({
  driverId,
  displayName,
  initialPhotoUrl,
  onChanged,
}: {
  driverId: string;
  displayName: string;
  initialPhotoUrl?: string | null;
  onChanged: (photoUrl: string | null) => void | Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setPhotoUrl(initialPhotoUrl ?? ""), [initialPhotoUrl]);
  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );

  const aspect = natural.width / natural.height;
  const baseWidth = aspect >= 1 ? PREVIEW_SIZE * aspect : PREVIEW_SIZE;
  const baseHeight = aspect >= 1 ? PREVIEW_SIZE : PREVIEW_SIZE / aspect;

  function clampPan(next: Point, nextZoom = zoom): Point {
    const maxX = Math.max(0, (baseWidth * nextZoom - PREVIEW_SIZE) / 2);
    const maxY = Math.max(0, (baseHeight * nextZoom - PREVIEW_SIZE) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function updateZoom(next: number) {
    const clamped = Math.max(1, Math.min(3, next));
    setZoom(clamped);
    setPan((current) => clampPan(current, clamped));
  }

  async function selectFile(file?: File) {
    setMessage(null);
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      setMessage("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setMessage("The original image must be 15 MB or smaller.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth < 256 || probe.naturalHeight < 256) {
        URL.revokeObjectURL(nextUrl);
        setMessage("Choose an image at least 256 × 256 pixels.");
        return;
      }
      if (probe.naturalWidth * probe.naturalHeight > 40_000_000) {
        URL.revokeObjectURL(nextUrl);
        setMessage("This image has too many pixels. Please resize it below 40 megapixels first.");
        return;
      }
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setNatural({ width: probe.naturalWidth, height: probe.naturalHeight });
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setSourceUrl(nextUrl);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      setMessage("That image could not be opened. Try another file.");
    };
    probe.src = nextUrl;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()];
    if (after.length === 1) {
      setPan((current) =>
        clampPan({
          x: current.x + event.clientX - previous.x,
          y: current.y + event.clientY - previous.y,
        }),
      );
      return;
    }
    if (before.length >= 2 && after.length >= 2) {
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      if (oldDistance > 0) updateZoom(zoom * (newDistance / oldDistance));
      const oldMid = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const newMid = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      setPan((current) =>
        clampPan({ x: current.x + newMid.x - oldMid.x, y: current.y + newMid.y - oldMid.y }),
      );
    }
  }

  function releasePointer(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
  }

  async function croppedJpeg(): Promise<Blob> {
    const image = imageRef.current;
    if (!image) throw new Error("Choose a picture first.");
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare the picture.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const scale = Math.max(OUTPUT_SIZE / natural.width, OUTPUT_SIZE / natural.height) * zoom;
    const width = natural.width * scale;
    const height = natural.height * scale;
    const previewToOutput = OUTPUT_SIZE / PREVIEW_SIZE;
    context.drawImage(
      image,
      (OUTPUT_SIZE - width) / 2 + pan.x * previewToOutput,
      (OUTPUT_SIZE - height) / 2 + pan.y * previewToOutput,
      width,
      height,
    );
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not process the picture."))),
        "image/jpeg",
        0.88,
      ),
    );
  }

  async function upload() {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await croppedJpeg();
      const response = await fetch(`/api/profile-photos/${encodeURIComponent(driverId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const result = await readUploadResponse(response);
      if (!response.ok)
        throw new Error(result.error || `Picture upload failed (${response.status}).`);
      if (!result.photoUrl)
        throw new Error(
          "The picture was accepted but no image URL was returned. Refresh and try again.",
        );
      setPhotoUrl(result.photoUrl);
      setSourceUrl(null);
      setMessage("Employee picture saved.");
      await onChanged(result.photoUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload the picture.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/profile-photos/${encodeURIComponent(driverId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await readUploadResponse(response);
      if (!response.ok)
        throw new Error(result.error || `Could not remove the picture (${response.status}).`);
      setPhotoUrl("");
      setSourceUrl(null);
      setMessage("Employee picture removed.");
      await onChanged(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          void selectFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {!sourceUrl ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="h-24 w-24 shrink-0 ring-2 ring-border">
            {photoUrl && <AvatarImage src={photoUrl} alt={displayName} className="object-cover" />}
            <AvatarFallback>
              <UserRound className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Employee picture</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a JPEG, PNG, or WebP up to 15 MB. You’ll crop it before saving.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {photoUrl ? "Replace picture" : "Upload picture"}
              </button>
              {photoUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-sm font-medium">Adjust picture</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag to reposition. Pinch, scroll, or use the slider to zoom. The circular guide shows
            the customer-facing crop.
          </p>
          <div className="mt-4 flex justify-center">
            <div
              className="relative touch-none overflow-hidden rounded-full bg-muted ring-4 ring-background shadow-[0_0_0_1px_var(--border)]"
              style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
              onWheel={(event) => {
                event.preventDefault();
                updateZoom(zoom + (event.deltaY > 0 ? -0.1 : 0.1));
              }}
              role="application"
              aria-label="Profile picture crop area. Drag to reposition and pinch to zoom."
            >
              <img
                ref={imageRef}
                src={sourceUrl}
                alt="Picture being cropped"
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: baseWidth,
                  height: baseHeight,
                  transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
              />
              <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-inset ring-white/80" />
            </div>
          </div>
          <div className="mx-auto mt-4 flex max-w-sm items-center gap-3">
            <ZoomOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input
              aria-label="Picture zoom"
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => updateZoom(Number(event.target.value))}
              className="w-full"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void upload()}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save cropped picture"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setSourceUrl(null)}
              className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

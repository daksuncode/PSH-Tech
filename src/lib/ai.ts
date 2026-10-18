// Browser side of the AI API served by the Worker (worker/).

import { useEffect, useState } from "react";
import type { BillMediaType, BillReading, BillResponse, StreamEvent } from "../../shared/protocol";

const API = `${import.meta.env.BASE_URL}api`;

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body?.error) return body.error;
  return res.status === 429 ? "Terlalu banyak permintaan. Coba lagi sebentar lagi." : `Server membalas ${res.status}.`;
}

/**
 * POSTs `body` and calls `onEvent` for each server-sent event until the
 * stream ends. Failures arrive as an `error` event, never as a throw (except
 * an abort through `signal`).
 */
export async function streamAi(
  path: "chat" | "explain",
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    onEvent({ type: "error", message: "Tidak bisa menghubungi server." });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: await errorMessage(res) });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Events are separated by a blank line; keep the trailing partial one.
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}

/** Downscales a photo (long edge ≤ 1568 px, the size Claude reads at full detail) to JPEG. */
async function prepareImage(file: File): Promise<{ data: string; mediaType: BillMediaType }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85),
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

export async function readBillPhoto(file: File): Promise<BillReading> {
  let image: { data: string; mediaType: BillMediaType };
  try {
    image = await prepareImage(file);
  } catch {
    throw new Error("File ini tidak bisa dibuka sebagai gambar.");
  }
  let res: Response;
  try {
    res = await fetch(`${API}/bill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: image.data, mediaType: image.mediaType }),
    });
  } catch {
    throw new Error("Tidak bisa menghubungi server.");
  }
  const body = (await res.json().catch(() => null)) as BillResponse | null;
  if (!res.ok || !body || "error" in body) {
    throw new Error(body && "error" in body ? body.error : await errorMessage(res));
  }
  return body.reading;
}

/** True when the Worker is reachable and has an API key configured. */
export function useAiAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { ai?: boolean } | null) => !cancelled && setAvailable(Boolean(h?.ai)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

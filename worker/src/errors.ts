import Anthropic from "@anthropic-ai/sdk";
import { ConfigError } from "./claude";
import type { Outcome } from "./metrics";

export type ClassifiedError = { outcome: Outcome; status: number; message: string };

/** Maps a failure to a metrics outcome, an HTTP status and a message for the user. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ConfigError) {
    return { outcome: "config_error", status: 503, message: "Layanan AI belum dikonfigurasi." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { outcome: "upstream_error", status: 503, message: "Layanan AI sedang sibuk. Coba lagi sebentar lagi." };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { outcome: "config_error", status: 503, message: "Layanan AI belum dikonfigurasi dengan benar." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { outcome: "error", status: 500, message: "Permintaan ke layanan AI tidak valid." };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { outcome: "upstream_error", status: 502, message: "Tidak bisa menghubungi layanan AI." };
  }
  if (err instanceof Anthropic.APIError) {
    return { outcome: "upstream_error", status: 502, message: "Layanan AI sedang gangguan. Coba lagi nanti." };
  }
  return { outcome: "error", status: 500, message: "Terjadi kesalahan di server." };
}

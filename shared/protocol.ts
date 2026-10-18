// Wire format between the frontend (src/) and the AI backend (worker/).

export type Level = "kabupaten" | "kecamatan";
export type DataSource = "nasa" | "gsa" | "diff";

/** A region as the map knows it: feature id within its level's data file. */
export type RegionRef = { level: Level; id: number };

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  /** Text-only history, oldest first, ending with the new user message. */
  messages: ChatTurn[];
  /** Region currently open in the app, if any. */
  region?: RegionRef | null;
};

export type ExplainRequest = {
  region: RegionRef;
  source: DataSource;
  /** 0 = annual average, 1..12 = month. */
  period: number;
};

export type BillMediaType = "image/jpeg" | "image/png" | "image/webp";

export type BillRequest = {
  /** Base64 image data without the data: URL prefix. */
  image: string;
  mediaType: BillMediaType;
};

/** What the AI could read from a PLN bill or token receipt. Null = not visible. */
export type BillReading = {
  terbaca: boolean;
  jenis_dokumen: "tagihan_pascabayar" | "struk_token_prabayar" | "lainnya";
  pemakaian_kwh: number | null;
  periode: string | null;
  daya_va: number | null;
  golongan_tarif: string | null;
  total_tagihan_rp: number | null;
  catatan: string;
};

export type BillResponse = { reading: BillReading } | { error: string };

/** One server-sent event on /api/chat and /api/explain (JSON in the data field). */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

export const LIMITS = {
  maxTurns: 20,
  maxUserChars: 2000,
  maxAssistantChars: 12000,
  /** ~5 MB of image data once decoded. */
  maxImageBase64Chars: 7_000_000,
} as const;

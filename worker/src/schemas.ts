import { z } from "zod";
import { LIMITS } from "../../shared/protocol";

// Validation messages reach users and the model; keep them in Indonesian.
z.config(z.locales.id());

export const RegionRefSchema = z.object({
  level: z.enum(["kabupaten", "kecamatan"]),
  id: z.number().int().min(0).max(100_000),
});

const Turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1, "Pesan tidak boleh kosong."),
});

export const ChatRequestSchema = z.object({
  messages: z
    .array(Turn)
    .min(1, "Pesan tidak boleh kosong.")
    .max(LIMITS.maxTurns, "Percakapan terlalu panjang. Mulai percakapan baru.")
    .refine((t) => t[t.length - 1]?.role === "user", "Pesan terakhir harus dari pengguna.")
    .refine(
      (t) => t.every((m) => m.content.length <= (m.role === "user" ? LIMITS.maxUserChars : LIMITS.maxAssistantChars)),
      "Pesan terlalu panjang.",
    ),
  region: RegionRefSchema.nullish(),
});

export const ExplainRequestSchema = z.object({
  region: RegionRefSchema,
  source: z.enum(["nasa", "gsa", "diff"]),
  period: z.number().int().min(0).max(12),
});

export const BillRequestSchema = z.object({
  image: z.string().min(100, "Gambar tidak valid.").max(LIMITS.maxImageBase64Chars, "Gambar terlalu besar (maks. ±5 MB)."),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const BillReadingSchema = z.object({
  terbaca: z.boolean(),
  jenis_dokumen: z.enum(["tagihan_pascabayar", "struk_token_prabayar", "lainnya"]),
  pemakaian_kwh: z.number().nullable(),
  periode: z.string().nullable(),
  daya_va: z.number().nullable(),
  golongan_tarif: z.string().nullable(),
  total_tagihan_rp: z.number().nullable(),
  catatan: z.string(),
});

/** First validation message, for a 400 response. */
export const firstIssue = (err: z.ZodError) => err.issues[0]?.message ?? "Permintaan tidak valid.";

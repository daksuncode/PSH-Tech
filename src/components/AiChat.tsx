import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LIMITS, type ChatTurn, type RegionRef } from "../../shared/protocol";
import { streamAi } from "../lib/ai";
import MarkdownText from "./MarkdownText";

type Message = ChatTurn & { tools: string[]; error?: string };

const SUGGESTIONS = [
  "Tagihan listrikku Rp600 ribu per bulan di Coblong, Bandung. Cocoknya berapa kWp?",
  "Bandingkan PSH Kupang dan Medan untuk PLTS atap.",
  "Kenapa angka NASA dan Global Solar Atlas bisa berbeda?",
];

type Props = {
  region: RegionRef | null;
  regionName: string | null;
  onClose: () => void;
};

/** Text-only history for the API: last turns that fit the limit, errors dropped. */
function history(messages: Message[]): ChatTurn[] {
  return messages
    .filter((m) => m.content.trim() && !m.error)
    .map(({ role, content }) => ({ role, content: content.slice(0, LIMITS.maxAssistantChars) }))
    .slice(-LIMITS.maxTurns);
}

export default function AiChat({ region, regionName, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Updates the assistant message being streamed (always the last one).
  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

  async function send(text: string) {
    const question = text.trim().slice(0, LIMITS.maxUserChars);
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: "user", content: question, tools: [] }];
    setMessages([...next, { role: "assistant", content: "", tools: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let breakBeforeText = false;
    try {
      await streamAi(
        "chat",
        { messages: history(next), region },
        (event) => {
          if (event.type === "text") {
            const sep = breakBeforeText ? "\n\n" : "";
            breakBeforeText = false;
            patchLast((m) => ({ ...m, content: m.content + (m.content ? sep : "") + event.text }));
          } else if (event.type === "tool") {
            // Text after a tool call starts a new paragraph.
            breakBeforeText = true;
            patchLast((m) => ({ ...m, tools: [...m.tools, event.label] }));
          } else if (event.type === "error") {
            patchLast((m) => ({ ...m, error: event.message }));
          }
        },
        ctrl.signal,
      );
    } catch {
      // Aborted (drawer closed or a new question): keep what arrived.
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <section className="ai-chat" aria-label="Asisten PLTS">
      <header className="ai-chat-header">
        <div>
          <h2>Asisten PLTS</h2>
          <span className="muted small">
            {regionName ? `Konteks: ${regionName}` : "Tanya soal panel surya di lokasimu"}
          </span>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup asisten">
          ×
        </button>
      </header>

      <div className="ai-chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-suggestions">
            <p className="muted">
              Aku bisa mencari PSH wilayahmu dan menghitung kapasitas, biaya, serta balik modal PLTS atap.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}`}>
            {m.tools.length > 0 && (
              <ul className="ai-tools">
                {m.tools.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
            )}
            {m.role === "assistant" ? (
              m.content ? (
                <MarkdownText text={m.content} />
              ) : (
                !m.error && busy && i === messages.length - 1 && <span className="muted">Sedang berpikir…</span>
              )
            ) : (
              <p>{m.content}</p>
            )}
            {m.error && <p className="ai-error">{m.error}</p>}
          </div>
        ))}
      </div>

      <form className="ai-chat-input" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tulis pertanyaan…"
          rows={2}
          maxLength={LIMITS.maxUserChars}
          aria-label="Pertanyaan untuk asisten"
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Kirim
        </button>
      </form>
      <p className="muted small ai-disclaimer">
        Jawaban AI bisa keliru. Angka PSH dan hitungan PLTS diambil dari data dan kalkulator aplikasi ini.
      </p>
    </section>
  );
}

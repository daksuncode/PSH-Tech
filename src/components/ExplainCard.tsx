import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { DataSource, RegionRef } from "../../shared/protocol";
import { streamAi } from "../lib/ai";

// The markdown renderer is only needed once an explanation arrives.
const MarkdownText = lazy(() => import("./MarkdownText"));

type Props = { region: RegionRef; source: DataSource; period: number };

/** "Jelaskan dengan AI": a streamed plain-language reading of the open region. */
export default function ExplainCard({ region, source, period }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // A different region, source or month makes the explanation stale.
  useEffect(() => {
    abortRef.current?.abort();
    setText("");
    setError(null);
    setBusy(false);
  }, [region.level, region.id, source, period]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function explain() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setText("");
    setError(null);
    setBusy(true);
    try {
      await streamAi(
        "explain",
        { region, source, period },
        (event) => {
          if (event.type === "text") setText((t) => t + event.text);
          else if (event.type === "error") setError(event.message);
        },
        ctrl.signal,
      );
    } catch {
      // aborted
    } finally {
      if (abortRef.current === ctrl) setBusy(false);
    }
  }

  return (
    <section className="explain">
      {!text && !busy && (
        <button type="button" className="secondary" onClick={() => void explain()}>
          Jelaskan dengan AI
        </button>
      )}
      {busy && !text && <p className="muted small">Menyusun penjelasan…</p>}
      {text && (
        <Suspense fallback={<p className="explain-text">{text}</p>}>
          <MarkdownText text={text} className="explain-text" />
        </Suspense>
      )}
      {error && <p className="ai-error">{error}</p>}
    </section>
  );
}

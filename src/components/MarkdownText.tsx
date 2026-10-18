import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** AI output as markdown. Raw HTML is not rendered (react-markdown's default). */
export default function MarkdownText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`markdown ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

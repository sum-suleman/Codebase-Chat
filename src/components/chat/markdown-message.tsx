"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { HighlightedCode } from "@/components/code/highlighted-code";

interface MarkdownMessageProps {
  content: string;
}

type MessageBlock =
  | { type: "code"; language: string; code: string }
  | { type: "prose"; text: string };

function splitCodeBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "prose",
        text: content.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: "code",
      language: match[1]?.trim() || "text",
      code: match[2].replace(/\n$/, ""),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: "prose",
      text: content.slice(lastIndex),
    });
  }

  return blocks;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted browser contexts
    }
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-cb-border bg-cb-sidebar">
      <div className="flex items-center justify-between border-b border-cb-border bg-cb-elevated/60 px-3 py-1.5 text-[11px] text-cb-text-secondary">
        <span className="font-mono lowercase">{language}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-cb-text-secondary transition-colors hover:bg-cb-elevated hover:text-cb-text-primary"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-cb-text-primary">
        <HighlightedCode code={code} language={language} />
      </pre>
    </div>
  );
}

function renderInlineTokens(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[\d+\])/g);

  return tokens.map((part, idx) => {
    if (!part) {
      return null;
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded border border-cb-border bg-cb-sidebar px-1.5 py-0.5 font-mono text-[12px] text-cb-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-cb-text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length >= 3) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (/^\[\d+\]$/.test(part)) {
      return (
        <span
          key={idx}
          className="mx-0.5 inline-flex items-center rounded bg-cb-primary/15 px-1.5 py-0.2 font-mono text-[11px] font-semibold text-cb-primary"
        >
          {part}
        </span>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function ProseBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const headingClass =
        level === 1
          ? "mt-3 mb-1.5 text-base font-bold text-cb-text-primary"
          : level === 2
            ? "mt-3 mb-1 text-sm font-semibold text-cb-text-primary"
            : "mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-cb-text-primary";

      elements.push(
        <div key={`h-${i}`} className={headingClass}>
          {renderInlineTokens(headingText)}
        </div>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-1.5 list-disc space-y-1 pl-5">
          {items.map((item, itemIdx) => (
            <li key={itemIdx} className="break-words">
              {renderInlineTokens(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-1.5 list-decimal space-y-1 pl-5">
          {items.map((item, itemIdx) => (
            <li key={itemIdx} className="break-words">
              {renderInlineTokens(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`bq-${i}`}
          className="my-2 border-l-2 border-cb-primary/60 pl-3 text-xs italic text-cb-text-secondary"
        >
          {renderInlineTokens(quoteLines.join(" "))}
        </blockquote>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">")
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }

    elements.push(
      <p key={`p-${i}`} className="my-1.5 whitespace-pre-wrap break-words leading-relaxed">
        {renderInlineTokens(paraLines.join("\n"))}
      </p>
    );
  }

  return <>{elements}</>;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const blocks = React.useMemo(() => splitCodeBlocks(content), [content]);

  return (
    <div className="space-y-1 text-sm text-cb-text-primary">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <CodeBlock
            key={`code-${index}`}
            language={block.language}
            code={block.code}
          />
        ) : (
          <ProseBlock key={`prose-${index}`} text={block.text} />
        )
      )}
    </div>
  );
}

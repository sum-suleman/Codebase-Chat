"use client";

import * as React from "react";

import {
  TOKEN_CLASS_NAMES,
  tokenizeCode,
  tokenizeCodeLines,
  type SyntaxToken,
} from "@/lib/syntax/highlight";

export function renderHighlightedTokens(tokens: SyntaxToken[]): React.ReactNode {
  if (tokens.length === 0) {
    return " ";
  }

  return tokens.map((token, idx) =>
    token.type === "plain" ? (
      <React.Fragment key={idx}>{token.value}</React.Fragment>
    ) : (
      <span key={idx} className={TOKEN_CLASS_NAMES[token.type]}>
        {token.value}
      </span>
    )
  );
}

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const tokenizedLines = React.useMemo(
    () => tokenizeCode(code, language),
    [code, language]
  );

  return (
    <code>
      {tokenizedLines.map((lineTokens, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {lineTokens.length > 0 ? renderHighlightedTokens(lineTokens) : ""}
          {lineIdx + 1 < tokenizedLines.length ? "\n" : ""}
        </React.Fragment>
      ))}
    </code>
  );
}

export { tokenizeCodeLines };

export type SyntaxTokenType =
  | "comment"
  | "string"
  | "keyword"
  | "type"
  | "number"
  | "function"
  | "property"
  | "operator"
  | "punctuation"
  | "plain";

export interface SyntaxToken {
  type: SyntaxTokenType;
  value: string;
}

export const TOKEN_CLASS_NAMES: Record<SyntaxTokenType, string> = {
  comment: "text-zinc-500 italic",
  string: "text-emerald-400",
  keyword: "text-sky-400 font-medium",
  type: "text-amber-300",
  number: "text-purple-400",
  function: "text-blue-300",
  property: "text-cyan-300",
  operator: "text-rose-300",
  punctuation: "text-zinc-400",
  plain: "text-cb-text-primary",
};

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  kotlin: "kotlin",
  dart: "dart",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "css",
  less: "css",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  toml: "toml",
  dockerfile: "dockerfile",
};

export function normalizeHighlightLanguage(language?: string): string {
  if (!language) {
    return "text";
  }
  const cleaned = language.trim().toLowerCase();
  return LANGUAGE_ALIASES[cleaned] ?? cleaned;
}

export function inferLanguageFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx < 0) {
    return "text";
  }
  const ext = fileName.slice(dotIdx + 1);
  return normalizeHighlightLanguage(ext);
}

const C_LIKE_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "defer",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "final",
  "finally",
  "fn",
  "for",
  "from",
  "func",
  "function",
  "go",
  "if",
  "impl",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "loop",
  "match",
  "mod",
  "mut",
  "namespace",
  "new",
  "null",
  "nil",
  "of",
  "override",
  "package",
  "private",
  "protected",
  "pub",
  "public",
  "readonly",
  "return",
  "sealed",
  "select",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "switch",
  "this",
  "throw",
  "trait",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unsafe",
  "use",
  "var",
  "void",
  "where",
  "while",
  "with",
  "yield",
]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "self",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

const SQL_KEYWORDS = new Set([
  "ADD",
  "ALL",
  "ALTER",
  "AND",
  "AS",
  "ASC",
  "BEGIN",
  "BETWEEN",
  "BY",
  "CASE",
  "CHECK",
  "COLUMN",
  "COMMIT",
  "CONSTRAINT",
  "CREATE",
  "DEFAULT",
  "DELETE",
  "DESC",
  "DISTINCT",
  "DROP",
  "ELSE",
  "ENABLE",
  "END",
  "EXISTS",
  "FALSE",
  "FOR",
  "FOREIGN",
  "FROM",
  "FUNCTION",
  "GRANT",
  "GROUP",
  "HAVING",
  "IF",
  "IN",
  "INDEX",
  "INNER",
  "INSERT",
  "INTO",
  "IS",
  "JOIN",
  "KEY",
  "LEFT",
  "LIMIT",
  "NOT",
  "NULL",
  "OFFSET",
  "ON",
  "OR",
  "ORDER",
  "OUTER",
  "POLICY",
  "PRIMARY",
  "PUBLIC",
  "REFERENCES",
  "REPLACE",
  "RETURN",
  "RETURNS",
  "REVOKE",
  "RIGHT",
  "ROLE",
  "ROLLBACK",
  "ROW",
  "SCHEMA",
  "SECURITY",
  "SELECT",
  "SET",
  "TABLE",
  "THEN",
  "TO",
  "TRIGGER",
  "TRUE",
  "UNIQUE",
  "UPDATE",
  "USING",
  "VALUES",
  "VIEW",
  "WHEN",
  "WHERE",
  "WITH",
]);

const BASH_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "readonly",
  "return",
  "select",
  "then",
  "until",
  "while",
]);

const BUILTIN_TYPES = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "Float32Array",
  "Float64Array",
  "Function",
  "Int32Array",
  "Map",
  "Number",
  "Object",
  "Promise",
  "Record",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "Uint8Array",
  "WeakMap",
  "WeakSet",
  "any",
  "bool",
  "boolean",
  "byte",
  "char",
  "double",
  "f32",
  "f64",
  "float",
  "i16",
  "i32",
  "i64",
  "i8",
  "int",
  "int32",
  "int64",
  "isize",
  "long",
  "never",
  "number",
  "object",
  "rune",
  "short",
  "str",
  "string",
  "u16",
  "u32",
  "u64",
  "u8",
  "uint",
  "unknown",
  "usize",
  "void",
]);

const HASH_COMMENT_LANGS = new Set([
  "python",
  "bash",
  "yaml",
  "toml",
  "ruby",
  "dockerfile",
]);

const SLASH_COMMENT_LANGS = new Set([
  "typescript",
  "javascript",
  "go",
  "rust",
  "java",
  "kotlin",
  "dart",
  "c",
  "cpp",
  "csharp",
  "php",
  "css",
  "json",
]);

function pushToken(tokens: SyntaxToken[], type: SyntaxTokenType, value: string) {
  if (!value) {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) {
    last.value += value;
  } else {
    tokens.push({ type, value });
  }
}

interface TokenizerState {
  inBlockComment: boolean;
  tripleQuote: '"""' | "'''" | null;
}

function tokenizeSingleLine(
  line: string,
  lang: string,
  state: TokenizerState
): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  const len = line.length;
  let i = 0;

  while (i < len) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf("*/", i);
      if (endIdx === -1) {
        pushToken(tokens, "comment", line.slice(i));
        return tokens;
      }
      pushToken(tokens, "comment", line.slice(i, endIdx + 2));
      state.inBlockComment = false;
      i = endIdx + 2;
      continue;
    }

    if (state.tripleQuote) {
      const endIdx = line.indexOf(state.tripleQuote, i);
      if (endIdx === -1) {
        pushToken(tokens, "string", line.slice(i));
        return tokens;
      }
      pushToken(tokens, "string", line.slice(i, endIdx + 3));
      state.tripleQuote = null;
      i = endIdx + 3;
      continue;
    }

    const ch = line[i];
    const next = i + 1 < len ? line[i + 1] : "";

    // Line comments
    if (SLASH_COMMENT_LANGS.has(lang) && ch === "/" && next === "/") {
      pushToken(tokens, "comment", line.slice(i));
      return tokens;
    }
    if (lang === "sql" && ch === "-" && next === "-") {
      pushToken(tokens, "comment", line.slice(i));
      return tokens;
    }
    if (HASH_COMMENT_LANGS.has(lang) && ch === "#") {
      pushToken(tokens, "comment", line.slice(i));
      return tokens;
    }

    // Block comments /* ... */
    if ((SLASH_COMMENT_LANGS.has(lang) || lang === "sql") && ch === "/" && next === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushToken(tokens, "comment", line.slice(i));
        state.inBlockComment = true;
        return tokens;
      }
      pushToken(tokens, "comment", line.slice(i, endIdx + 2));
      i = endIdx + 2;
      continue;
    }

    // Python triple-quoted strings
    if (
      lang === "python" &&
      (line.startsWith('"""', i) || line.startsWith("'''", i))
    ) {
      const quote = line.slice(i, i + 3) as '"""' | "'''";
      const endIdx = line.indexOf(quote, i + 3);
      if (endIdx === -1) {
        pushToken(tokens, "string", line.slice(i));
        state.tripleQuote = quote;
        return tokens;
      }
      pushToken(tokens, "string", line.slice(i, endIdx + 3));
      i = endIdx + 3;
      continue;
    }

    // Quoted strings: "...", '...', `...`
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      const literal = line.slice(i, j);
      // JSON keys followed by ':'
      if (lang === "json" && quote === '"') {
        let lookahead = j;
        while (lookahead < len && (line[lookahead] === " " || line[lookahead] === "\t")) {
          lookahead += 1;
        }
        if (line[lookahead] === ":") {
          pushToken(tokens, "property", literal);
          i = j;
          continue;
        }
      }
      pushToken(tokens, "string", literal);
      i = j;
      continue;
    }

    // Numbers
    if (
      /[0-9]/.test(ch) &&
      (i === 0 || !/[A-Za-z0-9_$]/.test(line[i - 1]))
    ) {
      const numMatch = line
        .slice(i)
        .match(/^(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?n?)/);
      if (numMatch) {
        pushToken(tokens, "number", numMatch[0]);
        i += numMatch[0].length;
        continue;
      }
    }

    // Identifiers, keywords, types, function calls, properties
    if (/[A-Za-z_$]/.test(ch)) {
      const idMatch = line.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
      if (idMatch) {
        const word = idMatch[0];
        const afterWordIdx = i + word.length;
        let lookahead = afterWordIdx;
        while (lookahead < len && (line[lookahead] === " " || line[lookahead] === "\t")) {
          lookahead += 1;
        }
        const nextChar = lookahead < len ? line[lookahead] : "";

        let tokenType: SyntaxTokenType = "plain";
        if (lang === "python" && PYTHON_KEYWORDS.has(word)) {
          tokenType = "keyword";
        } else if (lang === "sql" && SQL_KEYWORDS.has(word.toUpperCase())) {
          tokenType = "keyword";
        } else if (lang === "bash" && BASH_KEYWORDS.has(word)) {
          tokenType = "keyword";
        } else if (C_LIKE_KEYWORDS.has(word)) {
          tokenType = "keyword";
        } else if (
          (lang === "yaml" || lang === "toml") &&
          nextChar === ":"
        ) {
          tokenType = "property";
        } else if (BUILTIN_TYPES.has(word) || /^[A-Z][A-Za-z0-9_]*$/.test(word)) {
          tokenType = nextChar === "(" ? "function" : "type";
        } else if (nextChar === "(") {
          tokenType = "function";
        } else if (i > 0 && line[i - 1] === ".") {
          tokenType = "property";
        }

        pushToken(tokens, tokenType, word);
        i = afterWordIdx;
        continue;
      }
    }

    // Whitespace
    if (ch === " " || ch === "\t") {
      let j = i + 1;
      while (j < len && (line[j] === " " || line[j] === "\t")) {
        j += 1;
      }
      pushToken(tokens, "plain", line.slice(i, j));
      i = j;
      continue;
    }

    // Punctuation vs operators
    if ("()[]{}.,;:".includes(ch)) {
      pushToken(tokens, "punctuation", ch);
      i += 1;
      continue;
    }

    if ("=+-*/%&|^!~?".includes(ch)) {
      pushToken(tokens, "operator", ch);
      i += 1;
      continue;
    }

    pushToken(tokens, "plain", ch);
    i += 1;
  }

  return tokens;
}

export function tokenizeCodeLines(
  lines: string[],
  language?: string
): SyntaxToken[][] {
  const lang = normalizeHighlightLanguage(language);
  const state: TokenizerState = {
    inBlockComment: false,
    tripleQuote: null,
  };

  if (lang === "text") {
    return lines.map((line) => (line ? [{ type: "plain", value: line }] : []));
  }

  return lines.map((line) => tokenizeSingleLine(line, lang, state));
}

export function tokenizeCode(code: string, language?: string): SyntaxToken[][] {
  return tokenizeCodeLines(code.split("\n"), language);
}

import "server-only";

import type { RetrievedCodeChunk } from "@/lib/chat/retrieval";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_DEEPSEEK_CHAT_MODEL = "deepseek-chat";
const DEFAULT_GROQ_CHAT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GEMINI_CHAT_MODEL = "gemini-2.5-flash";

export type ChatProviderName = "openai" | "deepseek" | "groq" | "gemini";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamGroundedAnswerOptions {
  repositoryFullName: string;
  question: string;
  history: readonly ConversationTurn[];
  chunks: readonly RetrievedCodeChunk[];
  provider?: ChatProviderName;
  apiKey?: string;
  model?: string;
  endpointUrl?: string;
  signal?: AbortSignal;
}

interface ResolvedOpenAICompatibleConfig {
  provider: "openai" | "deepseek" | "groq";
  apiKey: string;
  endpointUrl: string;
  model: string;
}

function resolveChatProvider(
  options: StreamGroundedAnswerOptions
):
  | ResolvedOpenAICompatibleConfig
  | { provider: "gemini"; apiKey: string } {
  const explicitProvider =
    options.provider ??
    ((process.env.CHAT_PROVIDER ?? process.env.AI_PROVIDER ?? "")
      .trim()
      .toLowerCase() as ChatProviderName | "");

  const groqKey = (process.env.GROQ_API_KEY ?? "").trim();
  const deepseekKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  const geminiKey = (process.env.GEMINI_API_KEY ?? "").trim();

  const customBaseUrl = (
    options.endpointUrl ??
    process.env.CHAT_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    ""
  ).trim();

  const buildOpenAIConfig = (
    provider: "openai" | "deepseek" | "groq",
    key: string,
    defaultUrl: string,
    defaultModel: string
  ): ResolvedOpenAICompatibleConfig => {
    const resolvedUrl = customBaseUrl
      ? customBaseUrl.endsWith("/chat/completions")
        ? customBaseUrl
        : `${customBaseUrl.replace(/\/+$/, "")}/chat/completions`
      : defaultUrl;

    const resolvedModel = (
      options.model ??
      process.env.CHAT_MODEL ??
      process.env.OPENAI_CHAT_MODEL ??
      defaultModel
    ).trim();

    return {
      provider,
      apiKey: key,
      endpointUrl: resolvedUrl,
      model: resolvedModel || defaultModel,
    };
  };

  if (explicitProvider === "groq") {
    const key = (options.apiKey ?? groqKey).trim();
    if (!key) {
      throw new Error("GROQ_API_KEY is not configured for AI codebase chat.");
    }
    return buildOpenAIConfig(
      "groq",
      key,
      GROQ_CHAT_COMPLETIONS_URL,
      DEFAULT_GROQ_CHAT_MODEL
    );
  }

  if (explicitProvider === "deepseek") {
    const key = (options.apiKey ?? deepseekKey).trim();
    if (!key) {
      throw new Error("DEEPSEEK_API_KEY is not configured for AI codebase chat.");
    }
    return buildOpenAIConfig(
      "deepseek",
      key,
      DEEPSEEK_CHAT_COMPLETIONS_URL,
      DEFAULT_DEEPSEEK_CHAT_MODEL
    );
  }

  if (explicitProvider === "openai" || (!explicitProvider && options.apiKey)) {
    const key = (options.apiKey ?? openaiKey).trim();
    if (!key) {
      throw new Error("OPENAI_API_KEY is not configured for AI codebase chat.");
    }
    return buildOpenAIConfig(
      "openai",
      key,
      OPENAI_CHAT_COMPLETIONS_URL,
      DEFAULT_OPENAI_CHAT_MODEL
    );
  }

  if (explicitProvider === "gemini") {
    const resolvedGeminiKey = (options.apiKey ?? geminiKey).trim();
    if (!resolvedGeminiKey) {
      throw new Error("GEMINI_API_KEY is not configured for AI codebase chat.");
    }
    return { provider: "gemini", apiKey: resolvedGeminiKey };
  }

  if (groqKey) {
    return buildOpenAIConfig(
      "groq",
      groqKey,
      GROQ_CHAT_COMPLETIONS_URL,
      DEFAULT_GROQ_CHAT_MODEL
    );
  }
  if (deepseekKey) {
    return buildOpenAIConfig(
      "deepseek",
      deepseekKey,
      DEEPSEEK_CHAT_COMPLETIONS_URL,
      DEFAULT_DEEPSEEK_CHAT_MODEL
    );
  }
  if (openaiKey) {
    return buildOpenAIConfig(
      "openai",
      openaiKey,
      OPENAI_CHAT_COMPLETIONS_URL,
      DEFAULT_OPENAI_CHAT_MODEL
    );
  }
  if (geminiKey) {
    return { provider: "gemini", apiKey: geminiKey };
  }

  throw new Error(
    "No AI chat API key is configured. Set GROQ_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY."
  );
}

export function buildGroundedSystemPrompt(
  repositoryFullName: string,
  chunks: readonly RetrievedCodeChunk[]
): string {
  const contextBlocks =
    chunks.length === 0
      ? "No matching code chunks were retrieved from the repository index."
      : chunks
          .map(
            (chunk, index) =>
              `### Source [${index + 1}] — ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine}, language: ${chunk.language})\n\`\`\`${chunk.language}\n${chunk.content}\n\`\`\``
          )
          .join("\n\n");

  return [
    `You are an expert software engineer answering questions about the repository "${repositoryFullName}".`,
    "Follow these strict grounding rules:",
    "1. Answer ONLY using facts, symbols, configuration, and logic present in the Retrieved Code Sources below.",
    "2. Whenever you reference code, behavior, functions, or configuration, cite the exact file path and line range inline using `[file_path:Lstart-Lend]` (for example, `[src/lib/auth/session.ts:L12-L45]`).",
    "3. If the Retrieved Code Sources do not contain enough information to answer the question confidently, explicitly state what is missing rather than guessing or inventing files.",
    "4. Keep explanations clear, concise, and structured with Markdown code blocks where helpful.",
    "",
    "## Retrieved Code Sources",
    contextBlocks,
  ].join("\n");
}

function streamFromSseBody(
  body: ReadableStream<Uint8Array>,
  extractToken: (parsedJson: Record<string, unknown>) => string
): ReadableStream<string> {
  const upstreamReader = body.getReader();
  const decoder = new TextDecoder();

  return new ReadableStream<string>({
    async start(controller) {
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) {
              continue;
            }

            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const token = extractToken(parsed);
              if (token.length > 0) {
                controller.enqueue(token);
              }
            } catch {
              // Ignore keepalive or partial SSE lines
            }
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        upstreamReader.releaseLock();
      }
    },
    cancel() {
      void upstreamReader.cancel();
    },
  });
}

async function createGeminiAnswerStream(
  options: StreamGroundedAnswerOptions,
  apiKey: string,
  systemPrompt: string
): Promise<ReadableStream<string>> {
  const model = (
    options.model ??
    process.env.GEMINI_CHAT_MODEL ??
    DEFAULT_GEMINI_CHAT_MODEL
  )
    .trim()
    .replace(/^models\//, "");

  const endpointUrl =
    options.endpointUrl ??
    `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const contents = [
    ...options.history.slice(-8).map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    {
      role: "user",
      parts: [{ text: options.question }],
    },
  ];

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: 0.2,
        },
      }),
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Unable to contact the Gemini AI completion provider.");
  }

  if (!response.ok || !response.body) {
    throw new Error(
      `Gemini AI completion request failed with HTTP ${response.status}.`
    );
  }

  return streamFromSseBody(response.body, (parsed) => {
    const candidates = parsed.candidates as
      | Array<{
          content?: {
            parts?: Array<{ text?: unknown }>;
          };
        }>
      | undefined;
    const parts = candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return "";
    }
    return parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  });
}

async function createOpenAICompatibleAnswerStream(
  options: StreamGroundedAnswerOptions,
  config: ResolvedOpenAICompatibleConfig,
  systemPrompt: string
): Promise<ReadableStream<string>> {
  const recentHistory = options.history.slice(-4).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const candidateModels =
    config.provider === "groq" && !options.model
      ? Array.from(
          new Set([
            config.model,
            "openai/gpt-oss-20b",
            "llama-3.1-8b-instant",
          ])
        )
      : [config.model];

  const retryableStatuses = new Set([404, 429, 500, 502, 503, 504]);
  let response: Response | null = null;
  let lastStatus = 0;

  for (const model of candidateModels) {
    try {
      response = await fetch(config.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            ...recentHistory,
            { role: "user", content: options.question },
          ],
        }),
        cache: "no-store",
        signal: options.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(
        `Unable to contact the ${config.provider} AI completion provider.`
      );
    }

    lastStatus = response.status;
    if (response.ok && response.body) {
      break;
    }
    if (!retryableStatuses.has(response.status)) {
      break;
    }
  }

  if (!response || !response.ok || !response.body) {
    const errBody = response ? await response.text().catch(() => "") : "";
    console.error(`[${config.provider}] HTTP ${lastStatus}:`, errBody);
    throw new Error(
      `${config.provider.toUpperCase()} AI completion request failed with HTTP ${lastStatus}.`
    );
  }

  return streamFromSseBody(response.body, (parsed) => {
    const choices = parsed.choices as
      | Array<{
          delta?: { content?: unknown };
        }>
      | undefined;
    const token = choices?.[0]?.delta?.content;
    return typeof token === "string" ? token : "";
  });
}

export async function createGroundedAnswerStream(
  options: StreamGroundedAnswerOptions
): Promise<ReadableStream<string>> {
  const resolved = resolveChatProvider(options);
  const systemPrompt = buildGroundedSystemPrompt(
    options.repositoryFullName,
    options.chunks
  );

  if (resolved.provider === "gemini") {
    return createGeminiAnswerStream(options, resolved.apiKey, systemPrompt);
  }

  return createOpenAICompatibleAnswerStream(options, resolved, systemPrompt);
}

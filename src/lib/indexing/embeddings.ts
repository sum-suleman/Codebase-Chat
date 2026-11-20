import "server-only";

export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_EMBEDDING_BATCH_SIZE = 20;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface OpenAIEmbeddingDatum {
  index?: unknown;
  embedding?: unknown;
}

interface OpenAIEmbeddingResponse {
  data?: unknown;
}

interface GeminiBatchEmbedResponse {
  embeddings?: Array<{
    values?: unknown;
  }>;
}

export interface GenerateEmbeddingsOptions {
  provider?: "openai" | "gemini";
  apiKey?: string;
  model?: string;
  batchSize?: number;
  endpointUrl?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEmbeddingWithRetry(
  url: string,
  buildInit: () => RequestInit,
  networkErrorMessage: string
): Promise<Response> {
  let response: Response | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      response = await fetch(url, buildInit());
    } catch (err) {
      console.error(
        `[embeddings] Network attempt ${attempt + 1}/5 failed:`,
        err instanceof Error ? err.message : err
      );
      if (attempt === 4) {
        throw new Error(networkErrorMessage);
      }
      await sleep(Math.min(2_500 * Math.pow(2, attempt), 30_000));
      continue;
    }

    if ((response.status !== 429 && response.status !== 503) || attempt === 4) {
      return response;
    }

    const retryAfterSec = Number(response.headers.get("retry-after") || "0");
    const backoffMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000 + 500, 65_000)
        : Math.min(4_000 * Math.pow(2, attempt), 65_000);

    await sleep(backoffMs);
  }

  return response!;
}

function resolveEmbeddingProvider(options: GenerateEmbeddingsOptions): {
  provider: "openai" | "gemini";
  apiKey: string;
} {
  if (options.provider === "gemini") {
    const key = (options.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not configured for repository indexing."
      );
    }
    return { provider: "gemini", apiKey: key };
  }

  if (options.provider === "openai" || options.apiKey) {
    const key = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not configured for repository indexing."
      );
    }
    return { provider: "openai", apiKey: key };
  }

  const preferred = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const geminiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();

  if (preferred === "gemini" && geminiKey) {
    return { provider: "gemini", apiKey: geminiKey };
  }
  if (preferred === "openai" && openaiKey) {
    return { provider: "openai", apiKey: openaiKey };
  }
  if (geminiKey) {
    return { provider: "gemini", apiKey: geminiKey };
  }
  if (openaiKey) {
    return { provider: "openai", apiKey: openaiKey };
  }

  throw new Error(
    "Neither GEMINI_API_KEY nor OPENAI_API_KEY is configured for repository indexing."
  );
}

function resolveOpenAIEmbeddingModel(override?: string): string {
  const model = (
    override ??
    process.env.OPENAI_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL
  ).trim();
  return model || DEFAULT_EMBEDDING_MODEL;
}

function resolveGeminiEmbeddingModel(override?: string): string {
  const raw = (
    override ??
    process.env.GEMINI_EMBEDDING_MODEL ??
    DEFAULT_GEMINI_EMBEDDING_MODEL
  )
    .trim()
    .replace(/^models\//, "");
  return raw || DEFAULT_GEMINI_EMBEDDING_MODEL;
}

function validateVectorEntries(rawEmbedding: unknown): number[] {
  if (
    !Array.isArray(rawEmbedding) ||
    rawEmbedding.length !== EMBEDDING_DIMENSIONS
  ) {
    throw new Error("Embedding provider returned a malformed vector entry.");
  }

  const vector: number[] = [];
  for (const value of rawEmbedding) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding vector contains invalid numeric entries.");
    }
    vector.push(value);
  }
  return vector;
}

export function formatVectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSIONS}-dimension embedding vector, received ${embedding.length}.`
    );
  }

  for (let i = 0; i < embedding.length; i += 1) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error("Embedding vector contains non-finite numeric values.");
    }
  }

  return `[${embedding.join(",")}]`;
}

async function generateGeminiBatchEmbeddings(
  batch: readonly string[],
  apiKey: string,
  model: string,
  endpointUrlOverride?: string
): Promise<number[][]> {
  const endpointUrl =
    endpointUrlOverride ??
    `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:batchEmbedContents`;

  const body = JSON.stringify({
    requests: batch.map((text) => ({
      model: `models/${model}`,
      content: {
        parts: [{ text }],
      },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })),
  });

  const response = await fetchEmbeddingWithRetry(
    endpointUrl,
    () => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        Connection: "close",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }),
    "Unable to contact the Gemini embedding provider while indexing repository chunks."
  );

  if (!response.ok) {
    throw new Error(
      `Gemini embedding generation failed with HTTP ${response.status}.`
    );
  }

  let payload: GeminiBatchEmbedResponse;
  try {
    payload = (await response.json()) as GeminiBatchEmbedResponse;
  } catch {
    throw new Error("Gemini embedding provider returned an invalid JSON response.");
  }

  if (
    !Array.isArray(payload.embeddings) ||
    payload.embeddings.length !== batch.length
  ) {
    throw new Error(
      "Gemini embedding provider returned an incomplete vector batch."
    );
  }

  return payload.embeddings.map((item) => validateVectorEntries(item?.values));
}

async function generateOpenAIBatchEmbeddings(
  batch: readonly string[],
  apiKey: string,
  model: string,
  endpointUrl: string
): Promise<number[][]> {
  const body = JSON.stringify({
    model,
    input: batch,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const response = await fetchEmbeddingWithRetry(
    endpointUrl,
    () => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Connection: "close",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    }),
    "Unable to contact the embedding provider while indexing repository chunks."
  );

  if (!response.ok) {
    throw new Error(
      `Embedding generation failed with HTTP ${response.status}.`
    );
  }

  let payload: OpenAIEmbeddingResponse;
  try {
    payload = (await response.json()) as OpenAIEmbeddingResponse;
  } catch {
    throw new Error("Embedding provider returned an invalid JSON response.");
  }

  if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
    throw new Error("Embedding provider returned an incomplete vector batch.");
  }

  const orderedBatch = new Array<number[]>(batch.length);

  for (const rawItem of payload.data as OpenAIEmbeddingDatum[]) {
    if (
      typeof rawItem !== "object" ||
      rawItem === null ||
      typeof rawItem.index !== "number" ||
      !Number.isInteger(rawItem.index) ||
      rawItem.index < 0 ||
      rawItem.index >= batch.length
    ) {
      throw new Error("Embedding provider returned a malformed vector entry.");
    }

    orderedBatch[rawItem.index] = validateVectorEntries(rawItem.embedding);
  }

  for (const vector of orderedBatch) {
    if (!vector) {
      throw new Error("Embedding batch is missing one or more vectors.");
    }
  }

  return orderedBatch;
}

export async function generateTextEmbeddings(
  inputs: readonly string[],
  options: GenerateEmbeddingsOptions = {}
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const { provider, apiKey } = resolveEmbeddingProvider(options);
  const batchSize = Math.max(
    1,
    Math.min(100, Math.floor(options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE))
  );

  const allEmbeddings: number[][] = [];

  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    if (offset > 0 && provider === "gemini") {
      await sleep(1_000);
    }

    const batch = inputs.slice(offset, offset + batchSize).map((text) => {
      const normalized = text.trim();
      return normalized.length > 0 ? normalized : " ";
    });

    const batchVectors =
      provider === "gemini"
        ? await generateGeminiBatchEmbeddings(
            batch,
            apiKey,
            resolveGeminiEmbeddingModel(options.model),
            options.endpointUrl
          )
        : await generateOpenAIBatchEmbeddings(
            batch,
            apiKey,
            resolveOpenAIEmbeddingModel(options.model),
            options.endpointUrl ?? OPENAI_EMBEDDINGS_URL
          );

    allEmbeddings.push(...batchVectors);
  }

  return allEmbeddings;
}

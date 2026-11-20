-- =========================================================
-- Codebase Chat: Repository Indexing & Vector Storage
-- =========================================================

-- 1. Enable pgvector in the extensions schema
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Add composite uniqueness on repositories for tenant-safe FKs
ALTER TABLE public.repositories
    ADD CONSTRAINT repositories_id_owner_unique
    UNIQUE (id, owner_id);

-- =========================================================
-- 3. Repository Index Jobs
-- =========================================================

CREATE TABLE public.repository_index_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    repository_id UUID NOT NULL,

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'indexing', 'indexed', 'failed')),

    branch TEXT
        CHECK (branch IS NULL OR char_length(branch) <= 255),

    commit_sha TEXT
        CHECK (commit_sha IS NULL OR char_length(commit_sha) BETWEEN 7 AND 64),

    files_total INTEGER NOT NULL DEFAULT 0
        CHECK (files_total >= 0),

    files_indexed INTEGER NOT NULL DEFAULT 0
        CHECK (files_indexed >= 0),

    chunks_total INTEGER NOT NULL DEFAULT 0
        CHECK (chunks_total >= 0),

    error_message TEXT
        CHECK (error_message IS NULL OR char_length(error_message) <= 1000),

    started_at TIMESTAMPTZ,

    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT repository_index_jobs_repo_owner_fk
        FOREIGN KEY (repository_id, owner_id)
        REFERENCES public.repositories (id, owner_id)
        ON DELETE CASCADE
);

-- At most one active (queued or indexing) job per repository
CREATE UNIQUE INDEX repository_index_jobs_active_unique_idx
    ON public.repository_index_jobs (repository_id)
    WHERE status IN ('queued', 'indexing');

CREATE INDEX repository_index_jobs_repo_created_idx
    ON public.repository_index_jobs (repository_id, created_at DESC);

CREATE INDEX repository_index_jobs_owner_status_idx
    ON public.repository_index_jobs (owner_id, status);

-- =========================================================
-- 4. Repository Files
-- =========================================================

CREATE TABLE public.repository_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    repository_id UUID NOT NULL,

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    file_path TEXT NOT NULL
        CHECK (char_length(file_path) BETWEEN 1 AND 1024),

    blob_sha TEXT NOT NULL
        CHECK (char_length(blob_sha) BETWEEN 7 AND 64),

    language TEXT NOT NULL DEFAULT 'text'
        CHECK (char_length(language) BETWEEN 1 AND 64),

    byte_size INTEGER NOT NULL DEFAULT 0
        CHECK (byte_size >= 0),

    line_count INTEGER NOT NULL DEFAULT 0
        CHECK (line_count >= 0),

    chunk_count INTEGER NOT NULL DEFAULT 0
        CHECK (chunk_count >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT repository_files_repo_path_unique
        UNIQUE (repository_id, file_path),

    CONSTRAINT repository_files_id_repo_owner_unique
        UNIQUE (id, repository_id, owner_id),

    CONSTRAINT repository_files_repo_owner_fk
        FOREIGN KEY (repository_id, owner_id)
        REFERENCES public.repositories (id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX repository_files_owner_repo_idx
    ON public.repository_files (owner_id, repository_id);

-- =========================================================
-- 5. Repository Chunks (1536-dim embeddings + FTS)
-- =========================================================

CREATE TABLE public.repository_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    repository_id UUID NOT NULL,

    file_id UUID NOT NULL,

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    file_path TEXT NOT NULL
        CHECK (char_length(file_path) BETWEEN 1 AND 1024),

    language TEXT NOT NULL DEFAULT 'text'
        CHECK (char_length(language) BETWEEN 1 AND 64),

    chunk_index INTEGER NOT NULL
        CHECK (chunk_index >= 0),

    start_line INTEGER NOT NULL
        CHECK (start_line >= 1),

    end_line INTEGER NOT NULL
        CHECK (end_line >= start_line),

    token_count INTEGER NOT NULL DEFAULT 0
        CHECK (token_count >= 0),

    content TEXT NOT NULL
        CHECK (char_length(content) BETWEEN 1 AND 32768),

    embedding extensions.vector(1536) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT repository_chunks_file_chunk_unique
        UNIQUE (file_id, chunk_index),

    CONSTRAINT repository_chunks_file_repo_owner_fk
        FOREIGN KEY (file_id, repository_id, owner_id)
        REFERENCES public.repository_files (id, repository_id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX repository_chunks_repo_idx
    ON public.repository_chunks (repository_id);

CREATE INDEX repository_chunks_owner_repo_idx
    ON public.repository_chunks (owner_id, repository_id);

CREATE INDEX repository_chunks_embedding_hnsw_idx
    ON public.repository_chunks
    USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX repository_chunks_content_fts_idx
    ON public.repository_chunks
    USING gin (to_tsvector('simple', content));

-- =========================================================
-- 6. Triggers (updated_at + immutable owner_id)
-- =========================================================

CREATE TRIGGER set_repository_index_jobs_updated_at
BEFORE UPDATE ON public.repository_index_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_repository_files_updated_at
BEFORE UPDATE ON public.repository_files
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER prevent_repository_index_jobs_owner_change
BEFORE UPDATE ON public.repository_index_jobs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE TRIGGER prevent_repository_files_owner_change
BEFORE UPDATE ON public.repository_files
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE TRIGGER prevent_repository_chunks_owner_change
BEFORE UPDATE ON public.repository_chunks
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

-- =========================================================
-- 7. Semantic Vector Search RPC (SECURITY INVOKER)
-- =========================================================

CREATE OR REPLACE FUNCTION public.match_repository_chunks(
    p_repository_id UUID,
    p_query_embedding extensions.vector(1536),
    p_match_count INTEGER DEFAULT 8,
    p_similarity_threshold DOUBLE PRECISION DEFAULT 0.25
)
RETURNS TABLE (
    id UUID,
    repository_id UUID,
    file_id UUID,
    file_path TEXT,
    language TEXT,
    chunk_index INTEGER,
    start_line INTEGER,
    end_line INTEGER,
    content TEXT,
    similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    SELECT
        c.id,
        c.repository_id,
        c.file_id,
        c.file_path,
        c.language,
        c.chunk_index,
        c.start_line,
        c.end_line,
        c.content,
        1 - (c.embedding <=> p_query_embedding) AS similarity
    FROM public.repository_chunks AS c
    WHERE c.repository_id = p_repository_id
      AND 1 - (c.embedding <=> p_query_embedding) >= p_similarity_threshold
    ORDER BY c.embedding <=> p_query_embedding ASC
    LIMIT LEAST(GREATEST(p_match_count, 1), 30);
$$;

-- =========================================================
-- 8. Row Level Security & Permissions
-- =========================================================

ALTER TABLE public.repository_index_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repository_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repository_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own repository index jobs"
ON public.repository_index_jobs
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can view their own repository files"
ON public.repository_files
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can view their own repository chunks"
ON public.repository_chunks
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

REVOKE ALL ON TABLE public.repository_index_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.repository_files FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.repository_chunks FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.repository_index_jobs TO authenticated;
GRANT SELECT ON TABLE public.repository_files TO authenticated;
GRANT SELECT ON TABLE public.repository_chunks TO authenticated;

GRANT ALL ON TABLE public.repository_index_jobs TO service_role;
GRANT ALL ON TABLE public.repository_files TO service_role;
GRANT ALL ON TABLE public.repository_chunks TO service_role;

REVOKE EXECUTE ON FUNCTION public.match_repository_chunks(UUID, extensions.vector, INTEGER, DOUBLE PRECISION)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.match_repository_chunks(UUID, extensions.vector, INTEGER, DOUBLE PRECISION)
TO authenticated, service_role;

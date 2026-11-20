-- =========================================================
-- Codebase Chat: Repository Management
-- =========================================================

-- =========================================================
-- 1. Provider Connections
-- =========================================================

CREATE TABLE public.provider_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    provider TEXT NOT NULL
        CHECK (provider IN ('github', 'gitlab')),

    external_account_id TEXT NOT NULL
        CHECK (
            char_length(external_account_id) BETWEEN 1 AND 255
        ),

    account_login TEXT NOT NULL
        CHECK (
            char_length(account_login) BETWEEN 1 AND 255
        ),

    account_type TEXT NOT NULL DEFAULT 'user'
        CHECK (
            account_type IN ('user', 'organization')
        ),

    installation_id BIGINT,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            status IN ('pending', 'active', 'revoked', 'error')
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT provider_connections_unique_account
        UNIQUE (owner_id, provider, external_account_id),

    CONSTRAINT provider_connections_id_owner_unique
        UNIQUE (id, owner_id),

    CONSTRAINT provider_connections_id_owner_provider_unique
        UNIQUE (id, owner_id, provider),

    CONSTRAINT provider_connections_installation_check
        CHECK (
            installation_id IS NULL
            OR (
                provider = 'github'
                AND installation_id > 0
            )
        )
);

-- =========================================================
-- 2. Provider Credentials
-- =========================================================

CREATE TABLE public.provider_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    connection_id UUID NOT NULL,

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    credential_type TEXT NOT NULL
        CHECK (
            char_length(credential_type) BETWEEN 1 AND 50
        ),

    credential_ciphertext BYTEA NOT NULL,

    wrapped_dek BYTEA NOT NULL,

    nonce BYTEA NOT NULL,

    auth_tag BYTEA NOT NULL,

    key_version TEXT NOT NULL
        CHECK (
            char_length(key_version) BETWEEN 1 AND 100
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT provider_credentials_connection_type_unique
        UNIQUE (connection_id, credential_type),

    CONSTRAINT provider_credentials_connection_owner_fk
        FOREIGN KEY (connection_id, owner_id)
        REFERENCES public.provider_connections (id, owner_id)
        ON DELETE CASCADE
);

-- =========================================================
-- 3. Repositories
-- =========================================================

CREATE TABLE public.repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    connection_id UUID NOT NULL,

    provider TEXT NOT NULL
        CHECK (provider IN ('github', 'gitlab')),

    provider_repo_id TEXT NOT NULL
        CHECK (
            char_length(provider_repo_id) BETWEEN 1 AND 255
        ),

    full_name TEXT NOT NULL
        CHECK (
            char_length(full_name) BETWEEN 1 AND 255
        ),

    canonical_url TEXT NOT NULL
        CHECK (
            char_length(canonical_url) BETWEEN 1 AND 2048
            AND canonical_url LIKE 'https://%'
        ),

    default_branch TEXT,

    visibility TEXT NOT NULL
        CHECK (
            visibility IN ('public', 'private', 'internal')
        ),

    provider_archived BOOLEAN NOT NULL DEFAULT FALSE,

    disconnected_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT repositories_unique_provider_repo
        UNIQUE (owner_id, provider, provider_repo_id),

    CONSTRAINT repositories_connection_owner_provider_fk
        FOREIGN KEY (connection_id, owner_id, provider)
        REFERENCES public.provider_connections (id, owner_id, provider)
        ON DELETE CASCADE,

    CONSTRAINT repositories_default_branch_length
        CHECK (
            default_branch IS NULL
            OR char_length(default_branch) <= 255
        )
);

-- =========================================================
-- 4. Indexes
-- =========================================================

CREATE INDEX provider_connections_owner_idx
    ON public.provider_connections (owner_id);

CREATE INDEX provider_connections_status_idx
    ON public.provider_connections (owner_id, status);

CREATE INDEX provider_credentials_owner_idx
    ON public.provider_credentials (owner_id);

CREATE INDEX repositories_owner_idx
    ON public.repositories (owner_id);

CREATE INDEX repositories_connection_idx
    ON public.repositories (connection_id);

CREATE INDEX repositories_active_owner_idx
    ON public.repositories (owner_id)
    WHERE disconnected_at IS NULL;

-- =========================================================
-- 5. Updated At Triggers
-- =========================================================

CREATE TRIGGER set_provider_connections_updated_at
BEFORE UPDATE ON public.provider_connections
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_provider_credentials_updated_at
BEFORE UPDATE ON public.provider_credentials
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_repositories_updated_at
BEFORE UPDATE ON public.repositories
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 6. Prevent Ownership Changes
-- =========================================================

CREATE FUNCTION public.prevent_owner_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        RAISE EXCEPTION 'Changing record ownership is not permitted';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_provider_connection_owner_change
BEFORE UPDATE ON public.provider_connections
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE TRIGGER prevent_provider_credentials_owner_change
BEFORE UPDATE ON public.provider_credentials
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE TRIGGER prevent_repository_owner_change
BEFORE UPDATE ON public.repositories
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

-- =========================================================
-- 7. Enforce Five Active Repositories Per User
-- =========================================================

CREATE FUNCTION public.enforce_repository_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_count BIGINT;
BEGIN
    -- Serialize repository additions and reactivations
    -- belonging to the same user.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(NEW.owner_id::TEXT, 0)
    );

    SELECT pg_catalog.count(*)
    INTO active_count
    FROM public.repositories AS r
    WHERE r.owner_id = NEW.owner_id
      AND r.disconnected_at IS NULL
      AND (
          TG_OP = 'INSERT'
          OR r.id <> NEW.id
      );

    IF active_count >= 5 THEN
        RAISE EXCEPTION
            'Repository limit reached: maximum 5 active repositories per user'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_repository_limit
BEFORE INSERT OR UPDATE OF disconnected_at
ON public.repositories
FOR EACH ROW
WHEN (NEW.disconnected_at IS NULL)
EXECUTE FUNCTION public.enforce_repository_limit();

-- =========================================================
-- 8. Enable Row Level Security
-- =========================================================

ALTER TABLE public.provider_connections
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.provider_credentials
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.repositories
    ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 9. Provider Connection Policies
-- =========================================================

CREATE POLICY "Users can view their own provider connections"
ON public.provider_connections
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = owner_id
);

-- =========================================================
-- 10. Repository Policies
-- =========================================================

CREATE POLICY "Users can view their own repositories"
ON public.repositories
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) = owner_id
);

-- =========================================================
-- 11. Credential Access Restrictions
-- =========================================================

-- Credentials must never be accessible through ordinary
-- authenticated or anonymous client sessions.

REVOKE ALL ON TABLE public.provider_credentials
FROM PUBLIC, anon, authenticated;

-- No direct INSERT, UPDATE, or DELETE permissions for users
-- on connection metadata or repository metadata either.

REVOKE ALL ON TABLE public.provider_connections
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.repositories
FROM PUBLIC, anon, authenticated;

-- Allow authenticated users to read only their own records
-- through the RLS policies defined above.

GRANT SELECT ON TABLE public.provider_connections
TO authenticated;

GRANT SELECT ON TABLE public.repositories
TO authenticated;

-- Server-side service role access.
GRANT ALL ON TABLE public.provider_connections
TO service_role;

GRANT ALL ON TABLE public.provider_credentials
TO service_role;

GRANT ALL ON TABLE public.repositories
TO service_role;

-- =========================================================
-- 12. Restrict Trigger Function Execution
-- =========================================================

REVOKE EXECUTE ON FUNCTION public.prevent_owner_id_change()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_repository_limit()
FROM PUBLIC, anon, authenticated;

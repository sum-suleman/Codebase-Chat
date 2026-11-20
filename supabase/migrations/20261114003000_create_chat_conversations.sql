-- =========================================================
-- Codebase Chat: Persistent Conversations & Citations
-- =========================================================

-- 1. Conversations Table
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    repository_id UUID NOT NULL,

    title TEXT NOT NULL DEFAULT 'New conversation'
        CHECK (char_length(title) BETWEEN 1 AND 200),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT conversations_id_owner_unique
        UNIQUE (id, owner_id),

    CONSTRAINT conversations_repo_owner_fk
        FOREIGN KEY (repository_id, owner_id)
        REFERENCES public.repositories (id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX conversations_owner_updated_idx
    ON public.conversations (owner_id, updated_at DESC);

CREATE INDEX conversations_owner_repo_updated_idx
    ON public.conversations (owner_id, repository_id, updated_at DESC);

-- 2. Messages Table (with grounded file/line citations JSONB)
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL,

    owner_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    role TEXT NOT NULL
        CHECK (role IN ('user', 'assistant')),

    content TEXT NOT NULL
        CHECK (char_length(content) BETWEEN 1 AND 65536),

    citations JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(citations) = 'array'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT messages_conversation_owner_fk
        FOREIGN KEY (conversation_id, owner_id)
        REFERENCES public.conversations (id, owner_id)
        ON DELETE CASCADE
);

CREATE INDEX messages_conversation_created_idx
    ON public.messages (conversation_id, created_at ASC);

CREATE INDEX messages_owner_created_idx
    ON public.messages (owner_id, created_at DESC);

-- 3. Triggers (updated_at, immutable owner_id, bump conversation timestamp)
CREATE TRIGGER set_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER prevent_conversations_owner_change
BEFORE UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE TRIGGER prevent_messages_owner_change
BEFORE UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.prevent_owner_id_change();

CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    UPDATE public.conversations
    SET updated_at = NOW()
    WHERE id = NEW.conversation_id
      AND owner_id = NEW.owner_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER touch_conversation_after_message_insert
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_conversation_on_message();

-- 4. Row Level Security & Grants
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conversations"
ON public.conversations
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can create their own conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can update their own conversations"
ON public.conversations
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = owner_id)
WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can delete their own conversations"
ON public.conversations
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can view their own messages"
ON public.messages
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = owner_id);

CREATE POLICY "Users can insert their own messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = owner_id);

REVOKE ALL ON TABLE public.conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.messages FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations TO authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;

GRANT ALL ON TABLE public.conversations TO service_role;
GRANT ALL ON TABLE public.messages TO service_role;

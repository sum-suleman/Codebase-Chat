-- =========================================================
-- Codebase Chat: Profiles and Identity
-- =========================================================

-- 1. Create the profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    display_name TEXT
        CHECK (char_length(display_name) <= 80),

    avatar_url TEXT
        CHECK (char_length(avatar_url) <= 2048),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Restrict table permissions
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;

GRANT UPDATE (display_name, avatar_url)
ON TABLE public.profiles
TO authenticated;

-- 4. Users can only view their own profile
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = id);

-- 5. Users can only update their own profile
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

-- 6. Automatically update updated_at
CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 7. Automatically create a profile after signup
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        display_name,
        avatar_url
    )
    VALUES (
        NEW.id,
        NULLIF(LEFT(TRIM(NEW.raw_user_meta_data ->> 'full_name'), 80), ''),
        NULLIF(LEFT(TRIM(NEW.raw_user_meta_data ->> 'avatar_url'), 2048), '')
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- 8. Create profiles for any existing users
INSERT INTO public.profiles (id)
SELECT id
FROM auth.users
ON CONFLICT (id) DO NOTHING;
-- 9. Restrict execution of trigger functions
REVOKE EXECUTE ON FUNCTION public.set_updated_at()
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
FROM PUBLIC, anon, authenticated;

# Codebase Chat

**Codebase Chat** is a privacy-first, multi-provider AI code intelligence and repository exploration platform built with **Next.js 16 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS 4**, and **Supabase (`pgvector`)**. Connect GitHub and GitLab.com repositories, index source trees into 1536-dimension vector embeddings, browse syntax-highlighted files, run cross-repository semantic search, and ask grounded questions with exact file and line citations.

---

## Core Capabilities

- **Multi-Provider Repository Integrations**
  - **GitHub App Integration:** Signed state verification, short-lived read-only installation tokens, repository picker, and HMAC-SHA256 webhook synchronization (`installation`, `installation_repositories`, and repository lifecycle events).
  - **GitLab.com OAuth 2.0 (S256 PKCE):** Cryptographically bound PKCE authorization flow with AES-256-GCM envelope encryption (`TOKEN_ENCRYPTION_KEY`) for stored OAuth token bundles.
- **Line-Aware Indexing & Vector Search (`pgvector`)**
  - Deterministic source chunking with language detection, configurable overlap, and accurate start/end line tracking.
  - Batch embedding generation (`1536` dimensions) persisted in PostgreSQL and queried via the `match_repository_chunks` RPC function.
  - Dedicated **Semantic Code Search** workspace (`/search`) with cross-repository or single-repository scoping, language filtering, similarity scoring, and deep links to both the built-in viewer and GitHub/GitLab line anchors.
- **Grounded AI Codebase Chat & Thread Management**
  - Context-retrieved Q&A (`/chat`) backed by Groq, Gemini, OpenAI, or DeepSeek chat models with inline file/line citations and one-click preview.
  - Full **Conversations Manager** (`/conversations`) supporting search, repository filtering, sorting, inline title renaming, and single or bulk deletion.
- **Interactive File Browser & Global Command Palette (`Cmd+K` / `Ctrl+K`)**
  - Zero-dependency syntax highlighter (`src/lib/syntax/highlight.ts`) powering the repository file browser (`/repositories/[repositoryId]`), Markdown code blocks, and search snippets with automatic jump-to-line scrolling.
  - Global `Cmd+K` / `Ctrl+K` command palette (`CommandPalette`) for instant navigation across repositories, recent conversations, workspace routes, and live debounced semantic code matches.
- **Account & Security Hardening**
  - Supabase Auth with PKCE callback handling, password reset flows, profile avatar storage, Row-Level Security (RLS) across all user tables, and HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) in `next.config.ts`.

---

## Architecture Overview

```text
src/
├── app/
│   ├── (app)/                 # Authenticated workspace shell (Sidebar, Header, Cmd+K Palette)
│   │   ├── page.tsx           # Dashboard (stats, repository cards, activity timeline)
│   │   ├── repositories/      # Repository connection manager & indexed file browser
│   │   ├── chat/              # Grounded RAG codebase chat interface
│   │   ├── search/            # Cross-repository semantic code search workspace
│   │   ├── conversations/     # Saved thread search, rename, and bulk management
│   │   └── settings/          # GitHub App, GitLab OAuth, profile, and password settings
│   ├── (auth)/                # Login, signup, forgot-password, and reset-password flows
│   ├── auth/callback/         # Supabase PKCE auth exchange handler
│   └── api/
│       ├── chat/              # Grounded RAG completion & conversation persistence
│       ├── conversations/     # Conversation listing, renaming (PATCH), and deletion (DELETE)
│       ├── github/            # GitHub App install, callback, repo listing, and webhooks
│       ├── gitlab/            # GitLab PKCE connect, callback, and repo listing
│       ├── repositories/      # Asynchronous repository indexing & file reconstruction APIs
│       └── search/            # Authenticated vector semantic search endpoint
├── components/
│   ├── chat/                  # Chat workspace, Markdown renderer, citation previews
│   ├── code/                  # Syntax-highlighted code viewer components
│   ├── conversations/         # Conversations manager UI
│   ├── dashboard/             # Stat cards, activity feed, repository cards
│   ├── layout/                # AppShell, Sidebar, Header, BottomNav, CommandPalette
│   ├── repositories/          # Repository manager & tree-based file browser
│   ├── search/                # Semantic code search workspace
│   └── settings/              # Provider connection managers, profile & security forms
└── lib/
    ├── chat/                  # RAG retrieval, prompt assembly, conversation queries
    ├── indexing/              # File filtering, line-aware chunker, embeddings, pipeline
    ├── providers/             # GitHub App JWT/webhooks & GitLab PKCE/envelope crypto
    ├── repositories/          # Active repo management & chunk-to-file reconstruction
    ├── search/                # Cross-repo vector search & command palette item builder
    ├── supabase/              # SSR server/browser clients & admin service-role client
    └── syntax/                # Zero-dependency multi-language tokenizer
```

For deeper design specifications, see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`PROJECT_MASTER_PLAN.md`](./PROJECT_MASTER_PLAN.md).

---

## Prerequisites

- **Node.js:** `>=24.0.0 <25.0.0` (enforced via `package.json` `engines`)
- **Supabase Project:** PostgreSQL with the `pgvector` extension enabled
- **Provider Credentials:**
  - A **GitHub App** with read-only Contents/Metadata permissions, user authorization callback URL, and webhook secret
  - A **GitLab.com OAuth Application** with `read_api` scope
  - API keys for embeddings (**Gemini** or **OpenAI**) and chat completions (**Groq**, **Gemini**, **OpenAI**, or **DeepSeek**)

---

## Local Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in all required keys in `.env.local` (see the [Environment Variables](#environment-variables) table below).

3. **Apply Supabase database migrations:**
   Run the SQL migrations in `supabase/migrations/` in chronological order via the Supabase CLI (`supabase db push`) or the Supabase SQL Editor:
   - `20261110162852_create_profiles.sql`
   - `20261111073609_create_avatar_storage.sql`
   - `20261111150940_create_repository_management.sql`
   - `20261113213000_create_repository_indexing.sql`
   - `20261114003000_create_chat_conversations.sql`

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

---

## Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/publishable client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only, used for webhooks & indexing) |
| `SITE_URL` | Yes | Canonical origin without trailing slash (e.g. `http://localhost:3000` or `https://your-domain.com`) |
| `GITHUB_APP_ID` | Yes | Numeric GitHub App ID |
| `GITHUB_APP_SLUG` | Yes | GitHub App URL slug |
| `GITHUB_APP_PRIVATE_KEY` | Yes | PEM private key for signing GitHub App JWTs (`\n`-escaped in single-line env files) |
| `GITHUB_INSTALLATION_STATE_SECRET` | Yes | High-entropy secret (32+ bytes) for signing GitHub installation state cookies |
| `GITHUB_WEBHOOK_SECRET` | Yes | Secret configured on your GitHub App webhook for HMAC-SHA256 verification |
| `GITLAB_CLIENT_ID` | Yes | GitLab.com OAuth application ID |
| `GITLAB_CLIENT_SECRET` | Yes | GitLab.com OAuth application secret |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte hex or base64 key used for AES-256-GCM envelope encryption of OAuth tokens |
| `AI_PROVIDER` | Optional | Embedding provider selector (`gemini` default, or `openai`) |
| `GEMINI_API_KEY` | Conditional | Google Gemini API key (required when using Gemini embeddings or chat) |
| `GEMINI_EMBEDDING_MODEL` | Optional | Gemini embedding model (default: `gemini-embedding-001`) |
| `GEMINI_CHAT_MODEL` | Optional | Gemini chat model (default: `gemini-2.5-flash`) |
| `CHAT_PROVIDER` | Optional | Chat completion provider (`groq`, `gemini`, `openai`, or `deepseek`) |
| `CHAT_MODEL` | Optional | Model identifier for the selected `CHAT_PROVIDER` (e.g. `llama-3.3-70b-versatile`) |
| `GROQ_API_KEY` | Conditional | Groq API key (required when `CHAT_PROVIDER=groq`) |
| `OPENAI_API_KEY` | Conditional | OpenAI API key (required when `AI_PROVIDER=openai` or `CHAT_PROVIDER=openai`) |
| `OPENAI_BASE_URL` | Optional | Custom OpenAI-compatible base URL |
| `OPENAI_EMBEDDING_MODEL` | Optional | OpenAI embedding model (default: `text-embedding-3-small`) |
| `OPENAI_CHAT_MODEL` | Optional | OpenAI chat model (default: `gpt-4o-mini`) |
| `DEEPSEEK_API_KEY` | Conditional | DeepSeek API key (required when `CHAT_PROVIDER=deepseek`) |
| `CHAT_BASE_URL` | Optional | Custom chat completion endpoint override |

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the Next.js development server with Turbopack |
| `npm run build` | Create an optimized production build and run TypeScript checks |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint across the codebase |
| `npm test` | Execute all 117 unit tests across 28 suites via Node's native test runner |

---

## Production Deployment Checklist

1. **Runtime & Build:** Deploy on a Node 24 host (Vercel, Docker, Railway, or Render) using `npm run build` and `npm run start`.
2. **Environment Secrets:** Configure all required variables from `.env.example` in your hosting platform and set `SITE_URL` to your production HTTPS origin.
3. **OAuth & Webhook Callback URLs:**
   - **Supabase Auth Redirect URLs:** `${SITE_URL}/auth/callback` and `${SITE_URL}/reset-password` - **GitHub App Callback URL:** `${SITE_URL}/api/github/callback`
   - **GitHub App Webhook URL:** `${SITE_URL}/api/github/webhooks` - **GitLab OAuth Redirect URI:** `${SITE_URL}/api/gitlab/callback`
4. **Database Verification:** Confirm all 5 SQL migrations are applied, `pgvector` is enabled, RLS policies are active on user-owned tables, and `match_repository_chunks` returns ranked matches.

# Codebase Chat — Project Master Plan

## 1. Product Vision

Codebase Chat helps developers understand and explore software repositories by asking questions in natural language.

Users can connect authorized GitHub or GitLab repositories, explore their architecture, ask questions about their code, and receive evidence-based answers with file and line citations.

## 2. Project Status

- Project: Codebase Chat
- Development stage: MVP Complete & Deployed
- Live deployment: https://codebase-chat-seven.vercel.app (Vercel)
- Primary source control: Private GitLab repository (`sum-suleman/codebase-chat`)
- Public release mirror: Public GitHub repository (`sum-suleman/Codebase-Chat`, MIT License)
- Default branch: main
- Current milestone: MVP deployed and verified — post-launch showcase and v1.1 planning.

## 3. MVP Scope (Completed)

1. [x] Application shell and landing page.
2. [x] User authentication (Supabase Auth SSR).
3. [x] GitHub App and GitLab.com OAuth 2.0 (PKCE) repository integration.
4. [x] Repository file fetching with secret, binary, and build-artifact filtering.
5. [x] Indexing pipeline with progress tracking and failure handling.
6. [x] File parsing and deterministic line-aware chunking.
7. [x] 1536-dimension embeddings and Supabase `pgvector` storage.
8. [x] Retrieval-augmented generation (RAG) chat with multi-LLM provider support.
9. [x] Verifiable file and line citations with source-ID validation.
10. [x] Repository overview, file tree explorer, syntax highlighting, and `Cmd+K` search palette.
11. [x] Saved repositories and persistent conversation history.

## APPROVED DECISIONS

All nine strategic decision areas are approved and implemented for the MVP (detailed architecture in `ARCHITECTURE.md`):

1. **Product and account model — APPROVED & IMPLEMENTED.** Individual developer accounts only. Each user owns their repositories, indexing jobs, and conversations. No team workspaces, invitations, or organization billing in MVP.
2. **Database and infrastructure — APPROVED & IMPLEMENTED.** Supabase PostgreSQL with `pgvector` in Mumbai (`ap-south-1`), protected by Row-Level Security (RLS) across all user-owned tables.
3. **Application hosting — APPROVED & IMPLEMENTED.** Hosted on Vercel with asynchronous repository indexing, progress tracking, and failure recovery.
4. **GitHub — APPROVED & IMPLEMENTED.** Dedicated GitHub App with minimum read-only repository Metadata and Contents permissions and HMAC-SHA256 webhook verification. Supports public and private repositories with zero write permissions.
5. **GitLab — APPROVED & IMPLEMENTED.** GitLab.com OAuth 2.0 Authorization Code Flow with S256 PKCE and narrow read-only repository scopes. Supabase Auth remains separate for application authentication.
6. **AI providers and privacy — APPROVED & IMPLEMENTED.** Configurable multi-LLM answer generation (Groq, Gemini, OpenAI, DeepSeek) and 1536-dimension vector embeddings. Only relevant retrieved chunks are sent to AI providers; secrets and sensitive files are excluded prior to indexing.
7. **Repository storage and retention — APPROVED & IMPLEMENTED.** Extracted eligible source text, chunks, embeddings, repository metadata, and pinned commit SHAs are persisted; original archives are not retained. Supports repository disconnect and data deletion.
8. **MVP limits — APPROVED & IMPLEMENTED.** Enforces up to 5 active repositories/user, 5,000 files/repository, 1 MB/file, 100 MB eligible source/repository, and 1 concurrent indexing job/user across 18 supported languages (JavaScript, TypeScript, HTML, CSS, Python, Java, Go, PHP, Ruby, C#, C, C++, Rust, SQL, JSON, YAML, TOML, and Markdown).
9. **Browser, privacy and legal — APPROVED.** Supports current stable Chrome, Edge, Firefox, and Safari with a responsive interface. Public commercial launch remains gated on formal Privacy Policy, Terms of Service, and subprocessor disclosures.

## 4. Implemented Technology Stack

- **Frontend & Runtime:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, and shadcn/ui components on Node.js 24.
- **Authentication & Database:** Supabase Auth (`@supabase/ssr`) and Supabase PostgreSQL with `pgvector` (`ap-south-1`) and Row-Level Security (RLS).
- **Security:** AES-256-GCM envelope encryption for provider OAuth tokens, HMAC-SHA256 webhook signature verification, and strict HTTP security headers.
- **AI & Search:** 1536-dimension vector embeddings (`match_repository_chunks` RPC) and configurable multi-LLM chat providers (Groq, Gemini, OpenAI, DeepSeek).
- **Integrations:** Dedicated read-only GitHub App and GitLab.com OAuth 2.0 with PKCE.
- **Hosting & CI/CD:** Vercel production deployment connected to GitLab `main`, with a single-commit public release mirror on GitHub.

## 5. Core Engineering Principles

- Answers must be grounded in retrieved repository evidence.
- Important claims must include verifiable file and line citations.
- Never pretend to know code that has not been retrieved.
- Respect repository permissions and provider rate limits.
- Protect credentials and secrets at rest and in transit.
- Enforce authorization and database Row-Level Security.
- Treat imported repository content as untrusted input.
- Never execute imported repository code.
- Preserve commit SHA and exact 1-based source line information.

## 6. Development Workflow

1. ChatGPT coordinates and guides development.
2. Cursor investigates architecture and handles technical implementation.
3. Claude assists with product design and UX.
4. Gemini assists with scoped code generation.
5. ChatGPT helps integrate, inspect, and verify changes.
6. The project owner reviews and approves important changes.

## 7. Milestones

- [x] Create local project folder.
- [x] Install and verify Git, Node.js, and npm.
- [x] Create private GitLab repository.
- [x] Connect local Git repository to GitLab.
- [x] Prepare technical architecture proposal.
- [x] Approve strategic technology direction.
- [x] Verify exact package versions and compatibility at implementation start.
- [x] Resolve implementation-level infrastructure decisions.
- [x] Establish application foundation.
- [x] Implement MVP features.
- [x] Test security and functionality (117 automated unit tests across 28 suites, RLS, and token encryption).
- [x] Deploy MVP to Vercel and publish public GitHub release.

## 8. Architecture & Implementation Decisions

- **Framework & UI:** Locked on Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, a custom zero-dependency multi-language syntax highlighter, and a global `Cmd+K` / `Ctrl+K` command palette.
- **Vector Retrieval:** Standardized on 1536-dimension cosine similarity search via `pgvector` (`match_repository_chunks`) scoped by `owner_id`, `repository_id`, and active `index_version_id`.
- **Multi-LLM Flexibility:** Built behind provider adapters supporting Groq, Gemini, OpenAI, and DeepSeek with strict source-ID allowlisting and evidence-threshold abstention.
- **Credential Protection:** Implemented AES-256-GCM envelope encryption for stored GitHub/GitLab tokens so plaintext credentials never touch logs or client bundles.

## 9. Current Next Step (Post-MVP / v1.1)

1. Publish the live walkthrough video and LinkedIn launch showcase.
2. Evaluate automated webhook-triggered incremental reindexing on push events.
3. Complete formal Privacy Policy, Terms of Service, and subprocessor disclosures prior to opening for broader commercial usage.

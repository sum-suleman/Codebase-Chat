"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Trash2,
  User,
} from "lucide-react";

import { disconnectGitLabConnectionAction } from "@/app/actions/repositories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GitLabConnectionSummary } from "@/lib/providers/gitlab/client";

interface GitLabConnectionsProps {
  connections: GitLabConnectionSummary[];
  statusParam?: string;
  errorParam?: string;
  loadFailed?: boolean;
}

export function GitLabConnections({
  connections,
  statusParam,
  errorParam,
  loadFailed = false,
}: GitLabConnectionsProps) {
  const router = useRouter();
  const [disconnectingId, setDisconnectingId] = React.useState<string | null>(
    null
  );
  const [localFeedback, setLocalFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const successMessage =
    localFeedback?.type === "success"
      ? localFeedback.message
      : statusParam === "connected"
        ? "GitLab.com account connected successfully."
        : undefined;

  const errorMessage =
    localFeedback?.type === "error"
      ? localFeedback.message
      : errorParam
        ? errorParam
        : undefined;

  async function handleDisconnect(connectionId: string) {
    setLocalFeedback(null);
    setDisconnectingId(connectionId);
    try {
      const result = await disconnectGitLabConnectionAction(connectionId);
      setLocalFeedback({
        type: result.success ? "success" : "error",
        message: result.message,
      });
      if (result.success) {
        router.refresh();
      }
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {successMessage && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-cb-success/30 bg-cb-success/10 px-3.5 py-2.5 text-sm text-cb-success"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-cb-error/30 bg-cb-error/10 px-3.5 py-2.5 text-sm text-cb-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loadFailed && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-cb-error/30 bg-cb-error/10 px-3.5 py-2.5 text-sm text-cb-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Unable to load connected GitLab accounts right now.</span>
        </div>
      )}

      {connections.length > 0 ? (
        <ul className="divide-y divide-cb-border rounded-md border border-cb-border bg-cb-bg/40">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <User
                    className="h-4 w-4 text-cb-text-secondary"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-sm font-semibold text-cb-text-primary">
                    @{connection.accountLogin}
                  </span>
                  <Badge variant="outline">GitLab.com</Badge>
                  <Badge
                    variant={
                      connection.status === "active" ? "success" : "danger"
                    }
                  >
                    {connection.status === "active" ? "Active" : "Needs Attention"}
                  </Badge>
                </div>

                <p className="font-mono text-xs text-cb-text-secondary">
                  GitLab User ID: {connection.externalAccountId}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disconnectingId === connection.id}
                onClick={() => void handleDisconnect(connection.id)}
                className="text-cb-text-secondary hover:border-red-500/40 hover:text-red-400"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {disconnectingId === connection.id
                  ? "Disconnecting..."
                  : "Disconnect"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-cb-border bg-cb-bg/30 p-4 text-sm text-cb-text-secondary">
          No GitLab.com account connected yet. Authorize GitLab with OAuth 2.0
          PKCE (`read_api`) to import your GitLab projects.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-cb-text-secondary">
          Read-only OAuth 2.0 PKCE access (`read_api`) with encrypted token
          storage and automatic refresh rotation.
        </p>

        <a
          href="/api/gitlab/connect"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-cb-border bg-cb-elevated px-4 py-2 text-sm font-medium text-cb-text-primary shadow-sm transition-colors hover:bg-cb-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary focus-visible:ring-offset-2"
        >
          <GitBranch className="h-4 w-4" aria-hidden="true" />
          <span>
            {connections.length > 0 ? "Reconnect GitLab.com" : "Connect GitLab.com"}
          </span>
        </a>
      </div>
    </div>
  );
}

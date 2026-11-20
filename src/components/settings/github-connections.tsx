import { Building2, CheckCircle2, ExternalLink, GitBranch, User, AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  GitHubConnectionSummary,
  ProviderConnectionStatus,
} from "@/lib/providers/github/connections";

interface GitHubConnectionsProps {
  connections: GitHubConnectionSummary[];
  statusParam?: string;
  errorParam?: string;
  loadFailed?: boolean;
}

const STATUS_MESSAGES: Record<string, string> = {
  connected: "GitHub account connected successfully.",
  updated: "GitHub App installation permissions updated.",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    "Your GitHub connection session expired or could not be verified. Please try again.",
  invalid_request:
    "GitHub returned an unsupported setup action. Please try connecting again.",
  invalid_installation:
    "GitHub did not provide a valid installation identifier.",
  verification_failed:
    "Unable to verify that the GitHub installation belongs to Codebase Chat.",
  connection_failed:
    "Your GitHub installation was verified, but saving the connection failed. Please retry.",
  unavailable:
    "GitHub App integration is not configured in this environment yet.",
};

function getStatusBadge(status: ProviderConnectionStatus) {
  switch (status) {
    case "active":
      return <Badge variant="success">Active</Badge>;
    case "pending":
      return <Badge variant="warning">Pending</Badge>;
    case "revoked":
      return <Badge variant="danger">Revoked</Badge>;
    case "error":
      return <Badge variant="danger">Needs Attention</Badge>;
  }
}

export function GitHubConnections({
  connections,
  statusParam,
  errorParam,
  loadFailed = false,
}: GitHubConnectionsProps) {
  const successMessage = statusParam ? STATUS_MESSAGES[statusParam] : undefined;
  const errorMessage = errorParam ? ERROR_MESSAGES[errorParam] : undefined;

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
          <span>Unable to load connected GitHub accounts right now.</span>
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
                  {connection.accountType === "organization" ? (
                    <Building2
                      className="h-4 w-4 text-cb-text-secondary"
                      aria-hidden="true"
                    />
                  ) : (
                    <User
                      className="h-4 w-4 text-cb-text-secondary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="font-mono text-sm font-semibold text-cb-text-primary">
                    @{connection.accountLogin}
                  </span>
                  <Badge variant="outline">
                    {connection.accountType === "organization"
                      ? "Organization"
                      : "Personal"}
                  </Badge>
                  {getStatusBadge(connection.status)}
                </div>

                {connection.installationId && (
                  <p className="font-mono text-xs text-cb-text-secondary">
                    Installation ID: {connection.installationId}
                  </p>
                )}
              </div>

              <a
                href="/api/github/install"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-cb-border bg-transparent px-3 text-xs font-medium text-cb-text-primary transition-colors hover:bg-cb-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary focus-visible:ring-offset-2"
              >
                <span>Configure Access</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-cb-border bg-cb-bg/30 p-4 text-sm text-cb-text-secondary">
          No GitHub accounts connected yet. Install the Codebase Chat GitHub App
          to grant read-only repository access.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-xs text-cb-text-secondary">
          Read-only access to repository contents and metadata. Connect personal
          accounts or organizations.
        </p>

        <a
          href="/api/github/install"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cb-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary focus-visible:ring-offset-2"
        >
          <GitBranch className="h-4 w-4" aria-hidden="true" />
          <span>
            {connections.length > 0
              ? "Connect Another GitHub Account"
              : "Connect GitHub"}
          </span>
        </a>
      </div>
    </div>
  );
}

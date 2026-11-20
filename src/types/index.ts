export interface Repository {
  id: string;
  name: string;
  provider: "GitHub" | "GitLab";
  language: string;
  indexedFiles: number;
  status: "indexed" | "indexing" | "failed" | "pending";
  lastUpdated: string;
}

export interface Activity {
  id: string;
  type: "sync" | "query" | "connection";
  description: string;
  timestamp: string;
}

export interface DashboardStats {
  connectedRepos: number;
  indexedRepos: number;
  indexingInProgress: number;
  failedJobs: number;
}
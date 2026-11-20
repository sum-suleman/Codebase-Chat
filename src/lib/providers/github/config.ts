import "server-only";

export interface GitHubAppConfig {
  appId: string;
  appSlug: string;
  privateKey: string;
}

export function getGitHubAppConfig(): GitHubAppConfig {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const appSlug = process.env.GITHUB_APP_SLUG?.trim();
  const rawPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  const missingVariables: string[] = [];

  if (!appId) missingVariables.push("GITHUB_APP_ID");
  if (!appSlug) missingVariables.push("GITHUB_APP_SLUG");
  if (!rawPrivateKey?.trim()) {
    missingVariables.push("GITHUB_APP_PRIVATE_KEY");
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required GitHub App environment variables: ${missingVariables.join(", ")}`
    );
  }

  const validAppId = Array.from(appId!).every(
    (character) => character >= "0" && character <= "9"
  );

  if (!validAppId || appId![0] === "0") {
    throw new Error("GITHUB_APP_ID must be a positive numeric ID.");
  }

  const validSlugCharacters = Array.from(appSlug!).every(
    (character) =>
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "-"
  );

  const firstSlugCharacter = appSlug![0];
  const lastSlugCharacter = appSlug![appSlug!.length - 1];

  const validSlug =
    validSlugCharacters &&
    firstSlugCharacter !== "-" &&
    lastSlugCharacter !== "-";

  if (!validSlug) {
    throw new Error("GITHUB_APP_SLUG has an invalid format.");
  }

  const escapedNewline = String.fromCharCode(92) + "n";

  const privateKey = rawPrivateKey!
    .split(escapedNewline)
    .join("\n")
    .trim();

  const isPkcs8Key =
    privateKey.startsWith("-----BEGIN PRIVATE KEY-----") &&
    privateKey.endsWith("-----END PRIVATE KEY-----");

  const isRsaKey =
    privateKey.startsWith("-----BEGIN RSA PRIVATE KEY-----") &&
    privateKey.endsWith("-----END RSA PRIVATE KEY-----");

  if (!isPkcs8Key && !isRsaKey) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY must contain a valid PKCS#8 or RSA PEM envelope."
    );
  }

  return {
    appId: appId!,
    appSlug: appSlug!,
    privateKey,
  };
}

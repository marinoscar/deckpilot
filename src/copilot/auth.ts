export type TokenSource = 'explicit' | 'env:COPILOT_GITHUB_TOKEN' | 'env:GH_TOKEN' | 'env:GITHUB_TOKEN' | 'sdk-keychain';

export type TokenResolution = {
  token?: string;
  source: TokenSource | 'none';
};

export function resolveGitHubToken(explicit?: string): TokenResolution {
  if (explicit) return { token: explicit, source: 'explicit' };
  const copilot = process.env.COPILOT_GITHUB_TOKEN;
  if (copilot) return { token: copilot, source: 'env:COPILOT_GITHUB_TOKEN' };
  const gh = process.env.GH_TOKEN;
  if (gh) return { token: gh, source: 'env:GH_TOKEN' };
  const github = process.env.GITHUB_TOKEN;
  if (github) return { token: github, source: 'env:GITHUB_TOKEN' };
  return { source: 'none' };
}

export function describeTokenSource(source: TokenResolution['source']): string {
  switch (source) {
    case 'explicit':
      return 'explicitly provided token';
    case 'env:COPILOT_GITHUB_TOKEN':
      return '$COPILOT_GITHUB_TOKEN';
    case 'env:GH_TOKEN':
      return '$GH_TOKEN';
    case 'env:GITHUB_TOKEN':
      return '$GITHUB_TOKEN';
    case 'sdk-keychain':
      return 'Copilot CLI keychain (~/.copilot)';
    case 'none':
      return 'none — SDK will fall back to Copilot CLI keychain';
  }
}

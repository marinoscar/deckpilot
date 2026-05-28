import { render, useApp } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ChatSession } from '../chat/session.js';
import { createClient } from '../copilot/client.js';
import type { ProjectListEntry } from '../store/projects.js';
import type { TemplateListEntry } from '../store/templates.js';
import { App as ChatApp } from './App.js';
import { AuthErrorBanner } from './screens/AuthErrorBanner.js';
import { Help } from './screens/Help.js';
import { MainMenu } from './screens/MainMenu.js';
import { NewDeck } from './screens/NewDeck.js';
import { ProjectsBrowser } from './screens/ProjectsBrowser.js';
import { Settings } from './screens/Settings.js';
import { TemplatesBrowser } from './screens/TemplatesBrowser.js';

type StartOpts = { projectName?: string; templateName?: string };

type View =
  | { kind: 'main' }
  | { kind: 'projects' }
  | { kind: 'templates' }
  | { kind: 'new-deck' }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'chat'; session: ChatSession }
  | { kind: 'auth-error'; message: string; retry: () => Promise<void> };

type Props = {
  token?: string;
  model?: string;
  critiquePassesPerSlide?: number;
  initialView?: View;
};

/**
 * Top-level TUI router. Owns the current screen state and the ChatSession
 * lifecycle (so /quit from chat lands back on the menu rather than killing
 * the program).
 */
export const RootApp: React.FC<Props> = ({
  token,
  model,
  critiquePassesPerSlide,
  initialView = { kind: 'main' },
}) => {
  const { exit } = useApp();
  const [view, setView] = useState<View>(initialView);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view.kind !== 'chat') return;
    return () => {
      void view.session.stop().catch(() => {});
    };
  }, [view]);

  async function startChat(opts: StartOpts): Promise<void> {
    setBusy(true);
    const dp = createClient({ gitHubToken: token });
    const session = new ChatSession(dp, {
      model,
      critiquePassesPerSlide,
      projectName: opts.projectName,
      templateName: opts.templateName,
    });
    try {
      await session.start();
    } catch (e) {
      const err = e as Error;
      setBusy(false);
      if (isAuthError(err)) {
        // Tear down the half-started client before showing the banner.
        try {
          await session.stop();
        } catch {
          /* ignore */
        }
        setView({
          kind: 'auth-error',
          message: err.message,
          retry: () => startChat(opts),
        });
        return;
      }
      // Non-auth failures still mount the chat so the user can see context.
      session.addSystemMessage(`Failed to start session: ${err.message}`);
    }
    setBusy(false);
    setView({ kind: 'chat', session });
  }

  function back(): void {
    setView({ kind: 'main' });
  }

  async function endChat(): Promise<void> {
    if (view.kind === 'chat') {
      try {
        await view.session.stop();
      } catch {
        // already stopping
      }
    }
    setView({ kind: 'main' });
  }

  if (view.kind === 'chat') {
    return <ChatApp session={view.session} onExit={() => void endChat()} />;
  }

  if (view.kind === 'auth-error') {
    const retry = view.retry;
    return <AuthErrorBanner message={view.message} onRetry={() => void retry()} onBack={back} />;
  }

  if (view.kind === 'main') {
    return (
      <MainMenu
        busy={busy}
        onPick={(choice, payload) => {
          switch (choice) {
            case 'start':
              setView({ kind: 'new-deck' });
              return;
            case 'resume':
              if (payload?.projectName) {
                void startChat({ projectName: payload.projectName });
              } else {
                setView({ kind: 'projects' });
              }
              return;
            case 'projects':
              setView({ kind: 'projects' });
              return;
            case 'templates':
              setView({ kind: 'templates' });
              return;
            case 'settings':
              setView({ kind: 'settings' });
              return;
            case 'help':
              setView({ kind: 'help' });
              return;
            case 'quit':
              exit();
              return;
          }
        }}
      />
    );
  }

  if (view.kind === 'projects') {
    return (
      <ProjectsBrowser
        onOpen={(entry: ProjectListEntry) =>
          void startChat({ projectName: entry.name, templateName: entry.manifest.templateName })
        }
        onBack={back}
      />
    );
  }

  if (view.kind === 'templates') {
    return (
      <TemplatesBrowser
        onUseAndStart={(entry: TemplateListEntry) => void startChat({ templateName: entry.name })}
        onBack={back}
      />
    );
  }

  if (view.kind === 'new-deck') {
    return <NewDeck onStart={(opts) => void startChat(opts)} onBack={back} />;
  }

  if (view.kind === 'settings') {
    return <Settings onBack={back} />;
  }

  if (view.kind === 'help') {
    return <Help onBack={back} />;
  }

  return null;
};

/**
 * Recognise auth-shaped failures from the Copilot SDK / our auth resolver so
 * the chat UI doesn't half-mount on a credential problem.
 */
function isAuthError(err: Error): boolean {
  const name = (err.name ?? '').toLowerCase();
  const msg = (err.message ?? '').toLowerCase();
  if (name.includes('auth')) return true;
  return (
    msg.includes('unauthorized') ||
    msg.includes('authentication') ||
    msg.includes('not authenticated') ||
    msg.includes('no github token') ||
    msg.includes('invalid token') ||
    msg.includes('device flow') ||
    msg.includes('401')
  );
}

/** Convenience entry point used by `bin/run` and the menu command. */
export async function mountRootApp(opts: Props = {}): Promise<void> {
  const app = render(<RootApp {...opts} />);
  await app.waitUntilExit();
}

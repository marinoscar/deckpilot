import { render, useApp } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ChatSession } from '../chat/session.js';
import { createClient } from '../copilot/client.js';
import type { ProjectListEntry } from '../store/projects.js';
import type { SkillListEntry } from '../store/skills.js';
import type { TemplateListEntry } from '../store/templates.js';
import { type TemplateSpec, blankTemplate } from '../template/spec.js';
import { App as ChatApp } from './App.js';
import { AuthErrorBanner } from './screens/AuthErrorBanner.js';
import { Help } from './screens/Help.js';
import { MainMenu } from './screens/MainMenu.js';
import { NewDeck } from './screens/NewDeck.js';
import { ProjectsBrowser } from './screens/ProjectsBrowser.js';
import { Settings } from './screens/Settings.js';
import { SkillsBrowser } from './screens/SkillsBrowser.js';
import { TemplateEditor } from './screens/TemplateEditor.js';
import { TemplatesBrowser } from './screens/TemplatesBrowser.js';

type StartOpts = { projectName?: string; templateName?: string; skillName?: string };

type View =
  | { kind: 'main' }
  | { kind: 'projects'; mode: 'resume' | 'manage' }
  | { kind: 'templates' }
  | { kind: 'template-editor'; mode: 'create' | 'edit'; initial: TemplateSpec }
  | { kind: 'skills' }
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
      skillName: opts.skillName,
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
        onPick={(choice) => {
          switch (choice) {
            case 'start':
              setView({ kind: 'new-deck' });
              return;
            case 'resume':
              setView({ kind: 'projects', mode: 'resume' });
              return;
            case 'projects':
              setView({ kind: 'projects', mode: 'manage' });
              return;
            case 'templates':
              setView({ kind: 'templates' });
              return;
            case 'skills':
              setView({ kind: 'skills' });
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
        mode={view.mode}
        onOpen={(entry: ProjectListEntry) =>
          void startChat({
            projectName: entry.name,
            templateName: entry.manifest.templateName,
            skillName: entry.manifest.skillName,
          })
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
        onEdit={(entry) => setView({ kind: 'template-editor', mode: 'edit', initial: entry.spec })}
        onCreateNew={(name) =>
          setView({ kind: 'template-editor', mode: 'create', initial: blankTemplate(name) })
        }
      />
    );
  }

  if (view.kind === 'template-editor') {
    return (
      <TemplateEditor
        mode={view.mode}
        initial={view.initial}
        onSaved={() => setView({ kind: 'templates' })}
        onCancel={() => setView({ kind: 'templates' })}
      />
    );
  }

  if (view.kind === 'skills') {
    return (
      <SkillsBrowser
        onUseAndStart={(entry: SkillListEntry) => void startChat({ skillName: entry.name })}
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

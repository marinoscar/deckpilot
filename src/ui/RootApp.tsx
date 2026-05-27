import { render, useApp } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { ChatSession } from '../chat/session.js';
import { createClient } from '../copilot/client.js';
import type { ProjectListEntry } from '../store/projects.js';
import type { TemplateListEntry } from '../store/templates.js';
import { App as ChatApp } from './App.js';
import { Help } from './screens/Help.js';
import { MainMenu } from './screens/MainMenu.js';
import { NewDeck } from './screens/NewDeck.js';
import { ProjectsBrowser } from './screens/ProjectsBrowser.js';
import { Settings } from './screens/Settings.js';
import { TemplatesBrowser } from './screens/TemplatesBrowser.js';

type View =
  | { kind: 'main' }
  | { kind: 'projects' }
  | { kind: 'templates' }
  | { kind: 'new-deck' }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'chat'; session: ChatSession };

type Props = {
  /** Optional GitHub token override (forwarded to the Copilot SDK client when chat starts). */
  token?: string;
  /** Optional model override applied to every chat session. */
  model?: string;
  /** Default critique-passes budget. */
  critiquePassesPerSlide?: number;
  /** Pre-launch directly into one screen — used by `start <name>` and friends so the CLI shortcut still works. */
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
  // Track session state so the StatusBar in chat can reflect changes
  const [busy, setBusy] = useState(false);

  // When `view` becomes a chat, surface a top-level cleanup hook in case
  // the React tree unmounts (Ctrl+C from inside ink).
  useEffect(() => {
    if (view.kind !== 'chat') return;
    return () => {
      void view.session.stop().catch(() => {});
    };
  }, [view]);

  async function startChat(opts: {
    projectName?: string;
    templateName?: string;
  }): Promise<void> {
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
      session.addSystemMessage(`Failed to start session: ${(e as Error).message}`);
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
              setView({ kind: 'projects' });
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

/** Convenience entry point used by `bin/run` and the menu command. */
export async function mountRootApp(opts: Props = {}): Promise<void> {
  const app = render(<RootApp {...opts} />);
  await app.waitUntilExit();
}

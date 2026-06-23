import { render, useApp } from 'ink';
import type React from 'react';
import { useEffect, useState } from 'react';
import { IMPROVE_DOC_CHAR_BUDGET, IMPROVE_SEED_PROMPT } from '../chat/improve.js';
import { ChatSession } from '../chat/session.js';
import { TRANSFORM_DOC_CHAR_BUDGET, TRANSFORM_SEED_PROMPT } from '../chat/transform.js';
import { createClient } from '../copilot/client.js';
import { markCopilotOnboarded } from '../store/config.js';
import type { ProjectListEntry } from '../store/projects.js';
import type { SkillListEntry } from '../store/skills.js';
import type { TemplateListEntry } from '../store/templates.js';
import { type TemplateSpec, blankTemplate } from '../template/spec.js';
import { type UpdateInfo, checkForUpdate } from '../util/version-check.js';
import { App as ChatApp } from './App.js';
import { AuthErrorBanner } from './screens/AuthErrorBanner.js';
import { CopilotCheck } from './screens/CopilotCheck.js';
import { Doctor } from './screens/Doctor.js';
import { Help } from './screens/Help.js';
import { Improve } from './screens/Improve.js';
import { MainMenu } from './screens/MainMenu.js';
import { NewDeck } from './screens/NewDeck.js';
import { ProjectsBrowser } from './screens/ProjectsBrowser.js';
import { Settings } from './screens/Settings.js';
import { SkillsBrowser } from './screens/SkillsBrowser.js';
import { TemplateEditor } from './screens/TemplateEditor.js';
import { TemplatesBrowser } from './screens/TemplatesBrowser.js';
import { Transform } from './screens/Transform.js';

type StartOpts = {
  projectName?: string;
  templateName?: string;
  skillName?: string;
  /** Transform mode: restyle the deck (originalPath) into the active template's style. */
  transform?: { originalPath: string };
  /** Improve mode: critique a source deck and rebuild a better version. */
  improve?: { sourcePath: string };
};

type View =
  | { kind: 'copilot-check' }
  | { kind: 'main' }
  | { kind: 'projects'; mode: 'resume' | 'manage' }
  | { kind: 'templates' }
  | { kind: 'template-editor'; mode: 'create' | 'edit'; initial: TemplateSpec }
  | { kind: 'skills' }
  | { kind: 'new-deck' }
  | { kind: 'transform' }
  | { kind: 'improve' }
  | { kind: 'settings' }
  | { kind: 'doctor' }
  | { kind: 'help' }
  | { kind: 'chat'; session: ChatSession }
  | { kind: 'auth-error'; message: string; retry: () => Promise<void> };

type Props = {
  token?: string;
  model?: string;
  critiquePassesPerSlide?: number;
  initialView?: View;
  /** Running DeckPilot version (from oclif config) — drives the update check. */
  version?: string;
  /**
   * When true (first run / Copilot never verified), gate on the readiness
   * screen before the menu. Resolved by the `menu` command from the persisted
   * onboarding flag so already-verified users start instantly on the menu.
   */
  requireCopilotCheck?: boolean;
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
  initialView,
  version,
  requireCopilotCheck = false,
}) => {
  const { exit } = useApp();
  const [view, setView] = useState<View>(
    initialView ?? (requireCopilotCheck ? { kind: 'copilot-check' } : { kind: 'main' }),
  );
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // Non-blocking "newer version available?" check. Cached to once a day, so
  // most launches resolve instantly without any network call.
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    void checkForUpdate(version).then((info) => {
      if (!cancelled) setUpdate(info);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

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
      ...(opts.transform ? { transform: opts.transform } : {}),
      ...(opts.improve ? { improve: opts.improve } : {}),
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

    // Transform: seed a fresh project after the chat is mounted so the first
    // streamed turn is visible. A resumed transform already has a brief and its
    // style is re-applied by start().
    if (opts.transform && session.getBrief() === null && session.getAllSlideCode().size === 0) {
      void session.sendUserMessage(TRANSFORM_SEED_PROMPT, [], [opts.transform.originalPath], {
        maxDocChars: TRANSFORM_DOC_CHAR_BUDGET,
        maxTotalChars: TRANSFORM_DOC_CHAR_BUDGET,
      });
    }

    // Improve: seed a fresh project the same way — study + plan + rebuild.
    if (opts.improve && session.getBrief() === null && session.getAllSlideCode().size === 0) {
      void session.sendUserMessage(IMPROVE_SEED_PROMPT, [], [opts.improve.sourcePath], {
        maxDocChars: IMPROVE_DOC_CHAR_BUDGET,
        maxTotalChars: IMPROVE_DOC_CHAR_BUDGET,
      });
    }
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

  if (view.kind === 'copilot-check') {
    return (
      <CopilotCheck
        token={token}
        onReady={() => {
          // Persist so future launches skip the gate; failure to write is
          // non-fatal (next launch simply re-checks).
          void markCopilotOnboarded().catch(() => {});
          setView({ kind: 'main' });
        }}
        onContinueAnyway={() => setView({ kind: 'main' })}
        onQuit={() => exit()}
      />
    );
  }

  if (view.kind === 'auth-error') {
    const retry = view.retry;
    return <AuthErrorBanner message={view.message} onRetry={() => void retry()} onBack={back} />;
  }

  if (view.kind === 'main') {
    return (
      <MainMenu
        busy={busy}
        update={update}
        onPick={(choice) => {
          switch (choice) {
            case 'start':
              setView({ kind: 'new-deck' });
              return;
            case 'transform':
              setView({ kind: 'transform' });
              return;
            case 'improve':
              setView({ kind: 'improve' });
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
            case 'doctor':
              setView({ kind: 'doctor' });
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

  if (view.kind === 'transform') {
    return (
      <Transform
        onStart={(opts) =>
          void startChat({
            projectName: opts.projectName,
            templateName: opts.templateName,
            transform: { originalPath: opts.deckPath },
          })
        }
        onBack={back}
      />
    );
  }

  if (view.kind === 'improve') {
    return (
      <Improve
        onStart={(opts) =>
          void startChat({
            projectName: opts.projectName,
            templateName: opts.templateName,
            skillName: opts.skillName,
            improve: { sourcePath: opts.sourcePath },
          })
        }
        onBack={back}
      />
    );
  }

  if (view.kind === 'settings') {
    return <Settings onBack={back} />;
  }

  if (view.kind === 'doctor') {
    return <Doctor token={token} onBack={back} />;
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

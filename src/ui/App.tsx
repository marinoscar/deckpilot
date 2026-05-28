import { existsSync } from 'node:fs';
import { Box, Text, useApp, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ChatSession, SaveState, TranscriptEntry } from '../chat/session.js';
import { HELP_TEXT, parseSlash } from '../chat/slash.js';
import { summarizeBrief } from '../deck/brief.js';
import { renderDeck } from '../render/renderer.js';
import { listTemplates } from '../store/templates.js';
import { summarizeTemplate as summarizeTemplateProfile } from '../template/profile.js';
import { summarizeTemplate as summarizeTemplateSpec } from '../template/spec.js';
import { Prompt } from './Prompt.js';
import { StatusBar } from './StatusBar.js';
import { ThinkingIndicator } from './ThinkingIndicator.js';
import { Transcript } from './Transcript.js';

type Status = 'idle' | 'streaming' | 'cancelled' | 'error';

type Props = {
  session: ChatSession;
  /** If provided, /quit routes here (e.g. back to the menu) instead of exiting the program. */
  onExit?: () => void;
};

export const App: React.FC<Props> = ({ session, onExit }) => {
  const { exit } = useApp();
  const leave = () => (onExit ? onExit() : exit());
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [model, setModel] = useState<string>(session.getModel());
  const [projectName, setProjectName] = useState<string | null>(session.getProjectName());
  const [templateName, setTemplateName] = useState<string | null>(
    session.getActiveTemplateName() ?? null,
  );
  const [saveState, setSaveState] = useState<SaveState | null>(session.getSaveState());
  const lastCtrlC = useRef<number>(0);

  useEffect(() => session.subscribe(setEntries), [session]);
  useEffect(() => session.onModelChange(setModel), [session]);
  useEffect(
    () =>
      session.onProjectChange((m) => {
        setProjectName(m?.name ?? null);
        setTemplateName(m?.templateName ?? session.getActiveTemplateName() ?? null);
      }),
    [session],
  );
  useEffect(
    () =>
      session.onBusyChange((busy) => {
        setStatus((prev) => {
          if (busy) return 'streaming';
          if (prev === 'error') return 'error';
          return 'idle';
        });
      }),
    [session],
  );
  useEffect(() => session.onSaveStateChange((s) => setSaveState(s)), [session]);

  useInput(async (input, key) => {
    if (key.ctrl && (input === 'c' || input === '\x03')) {
      const now = Date.now();
      if (now - lastCtrlC.current < 1200) {
        await session.stop();
        leave();
        return;
      }
      lastCtrlC.current = now;
      if (status === 'streaming') {
        await session.cancel();
        setStatus('cancelled');
        session.addSystemMessage('Generation cancelled. Press Ctrl+C again to exit.');
        setTimeout(() => setStatus('idle'), 600);
      } else {
        session.addSystemMessage('Press Ctrl+C again to exit.');
      }
    }
  });

  async function handleSubmit(text: string) {
    const slash = parseSlash(text);
    if (slash) {
      await handleSlash(slash, text);
      return;
    }
    try {
      await session.sendUserMessage(text);
    } catch (e) {
      setStatus('error');
      session.addSystemMessage(`error: ${(e as Error).message}`);
    }
  }

  async function handleSlash(slash: ReturnType<typeof parseSlash>, raw: string): Promise<void> {
    if (!slash) return;
    switch (slash.kind) {
      case 'help':
        session.addSystemMessage(HELP_TEXT);
        return;
      case 'clear':
        session.clear();
        session.addSystemMessage(
          'Transcript cleared on screen. (The deck is preserved in ~/.deckpilot/projects/.)',
        );
        return;
      case 'new':
        session.clear();
        session.addSystemMessage(
          'Transcript cleared. The next propose_deck_brief will replace the current deck in this project.',
        );
        return;
      case 'render': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage(
            'No deck yet. Ask the agent first (e.g. "make me a 6-slide intro to vector databases for a CTO audience").',
          );
          return;
        }
        const out = slash.outputPath ?? session.defaultOutputPath();
        session.addSystemMessage(`Rendering ${brief.slides.length}-slide deck → ${out} …`);
        try {
          const abs = await renderDeck(brief, session.getAllSlideCode(), out, {
            template: session.getTemplate() ?? undefined,
          });
          session.addSystemMessage(`Wrote ${abs}`);
        } catch (e) {
          session.addSystemMessage(`render failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'save': {
        try {
          if (slash.projectName) {
            await session.renameCurrentProject(slash.projectName);
            session.addSystemMessage(`Renamed project → ${slash.projectName} and flushed.`);
          } else {
            await session.flush();
            const proj = session.getProjectName();
            session.addSystemMessage(
              proj ? `Flushed project "${proj}" to disk.` : 'No active project to save.',
            );
          }
        } catch (e) {
          session.addSystemMessage(`save failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'project': {
        if (!slash.arg) {
          const manifest = session.getProjectManifest();
          if (!manifest) {
            session.addSystemMessage('No active project.');
          } else {
            session.addSystemMessage(
              `Project "${manifest.name}"  (updated ${manifest.updatedAt})  template: ${manifest.templateName ?? '(none)'}`,
            );
          }
          return;
        }
        try {
          await session.renameCurrentProject(slash.arg);
          session.addSystemMessage(`Renamed project → ${slash.arg}.`);
        } catch (e) {
          session.addSystemMessage(`Rename failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'templates': {
        const list = await listTemplates();
        if (list.length === 0) {
          session.addSystemMessage(
            'No named templates yet. Create one with: deckpilot template create <name> [--from <pptx>].',
          );
          return;
        }
        session.addSystemMessage(
          ['Saved templates:', ...list.map((e) => `  ${summarizeTemplateSpec(e.spec)}`)].join('\n'),
        );
        return;
      }
      case 'template': {
        if (!slash.arg) {
          const named = session.getResolvedTemplate();
          const oneShot = session.getTemplate();
          if (named) {
            session.addSystemMessage(`Active template: ${summarizeTemplateSpec(named)}`);
          } else if (oneShot) {
            session.addSystemMessage(
              `Active one-shot template (no save): ${summarizeTemplateProfile(oneShot)}`,
            );
          } else {
            session.addSystemMessage(
              'No template applied. Use /template <name> or /template <path-to-pptx>.',
            );
          }
          return;
        }
        if (slash.arg === 'none') {
          session.clearTemplate();
          session.addSystemMessage('Cleared the active template.');
          return;
        }
        // Disambiguate: named template (kebab, exists) vs one-shot .pptx path.
        const arg = slash.arg;
        if (/^[a-z0-9-]+$/.test(arg) && !existsSync(arg)) {
          try {
            const resolved = await session.useNamedTemplate(arg);
            session.addSystemMessage(
              `Template "${arg}" applied: ${summarizeTemplateSpec(resolved)}`,
            );
          } catch (e) {
            session.addSystemMessage(`Could not apply template "${arg}": ${(e as Error).message}`);
          }
        } else {
          try {
            const profile = await session.loadTemplate(arg);
            session.addSystemMessage(
              `One-shot template inherited from ${profile.sourcePath}: ${summarizeTemplateProfile(profile)}`,
            );
          } catch (e) {
            session.addSystemMessage(`Template load failed: ${(e as Error).message}`);
          }
        }
        return;
      }
      case 'load': {
        if (!slash.path) {
          session.addSystemMessage('Usage: /load <path-to-brief.json>');
          return;
        }
        session.addSystemMessage(`Loading brief ${slash.path} …`);
        try {
          const brief = await session.loadBriefFromFile(slash.path);
          session.addSystemMessage(
            `Loaded ${brief.slides.length}-slide brief "${brief.meta.title}". Slide code (if saved alongside) is NOT auto-loaded — ask the agent to rewrite or hand-paste it.`,
          );
        } catch (e) {
          session.addSystemMessage(`Brief load failed: ${(e as Error).message}`);
        }
        return;
      }
      case 'outline': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage('No deck yet.');
          return;
        }
        session.addSystemMessage(summarizeBrief(brief));
        return;
      }
      case 'show': {
        const brief = session.getBrief();
        if (!brief) {
          session.addSystemMessage('No deck yet.');
          return;
        }
        session.addSystemMessage(JSON.stringify(brief, null, 2));
        return;
      }
      case 'undo': {
        const undone = session.undo();
        session.addSystemMessage(undone ? 'Reverted the last deck change.' : 'Nothing to undo.');
        return;
      }
      case 'model': {
        if (!slash.id) {
          session.addSystemMessage(`Current model: ${session.getModel()}`);
          return;
        }
        session.addSystemMessage(`Switching model → ${slash.id} …`);
        await session.switchModel(slash.id);
        return;
      }
      case 'models': {
        session.addSystemMessage('Fetching model list …');
        try {
          const models = await session.listModels();
          const cur = session.getModel();
          const lines = models.map((m) => {
            const marker = m.id === cur ? '* ' : '  ';
            return `${marker}${m.id.padEnd(30)} ${m.name}`;
          });
          session.addSystemMessage(
            `Available models (use /model <id> to switch):\n${lines.join('\n')}`,
          );
        } catch (e) {
          session.addSystemMessage(`Could not list models: ${(e as Error).message}`);
        }
        return;
      }
      case 'critique': {
        if (!slash.slideId) {
          session.addSystemMessage(
            `Critique passes per slide: ${session.getCritiquePasses()}. Usage: /critique <slide-id> to force a fresh preview pass on a specific slide.`,
          );
          return;
        }
        session.resetCritiqueUsage(slash.slideId);
        session.addSystemMessage(
          `Critique budget reset for "${slash.slideId}". Ask the agent to re-preview it.`,
        );
        return;
      }
      case 'critique-passes': {
        if (typeof slash.n !== 'number') {
          session.addSystemMessage(
            `Critique passes per slide: ${session.getCritiquePasses()} (max 5).`,
          );
          return;
        }
        const next = session.setCritiquePasses(slash.n);
        session.addSystemMessage(`Critique passes per slide set to ${next}.`);
        return;
      }
      case 'style-guide': {
        const guide = session.getStyleGuide();
        if (!guide) {
          session.addSystemMessage(
            'No DECKPILOT.md found in this directory (or any ancestor). Create one to set persistent style/instruction rules for the agent.',
          );
          return;
        }
        session.addSystemMessage(
          `Active style guide: ${guide.path} (${guide.bytes} bytes). Its rules are binding for this deck.`,
        );
        return;
      }
      case 'quit':
        await session.stop();
        leave();
        return;
      case 'unknown':
        session.addSystemMessage(`Unknown slash command: ${raw}. Try /help for the list.`);
        return;
    }
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text color="cyanBright" bold>
          DeckPilot
        </Text>
        <Text dimColor> · conversational PowerPoint via GitHub Copilot</Text>
      </Box>
      <Transcript entries={entries} />
      <Box marginTop={1} flexDirection="column">
        {status === 'streaming' ? (
          <ThinkingIndicator />
        ) : (
          <Prompt disabled={false} onSubmit={handleSubmit} />
        )}
        <StatusBar
          status={status}
          model={model}
          project={projectName}
          template={templateName}
          saveState={saveState}
        />
      </Box>
    </Box>
  );
};

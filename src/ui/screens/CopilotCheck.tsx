import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type CopilotReadiness, checkCopilotReadiness } from '../../copilot/readiness.js';
import { Panel } from '../menu/Panel.js';

type Props = {
  /** Explicit GitHub token forwarded from the CLI flag, if any. */
  token?: string;
  /** Called when Copilot is verified installed, signed in, and ready. */
  onReady: () => void;
  /** Called when the user chooses to continue despite a failed check. */
  onContinueAnyway: () => void;
  /** Called when the user quits from the gate. */
  onQuit: () => void;
};

type Phase = { kind: 'checking' } | { kind: 'failed'; report: CopilotReadiness };

/**
 * First-run gate shown by RootApp before the menu, the very first time
 * DeckPilot is launched (or whenever Copilot has never been verified). It
 * confirms GitHub Copilot is present, signed in, and reachable so the user
 * isn't surprised by an auth wall the moment they start their first deck.
 *
 * On success it advances to the menu and the result is persisted so later
 * launches start instantly. On failure it shows one clear next step.
 */
export const CopilotCheck: React.FC<Props> = ({ token, onReady, onContinueAnyway, onQuit }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  // Hold the latest onReady so the probe effect can fire on [token, attempt]
  // alone — RootApp passes a fresh arrow each render, and depending on it
  // directly would re-trigger the check in a loop on the failed branch.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is a recheck nonce — bumping it re-runs the probe on demand.
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'checking' });
    void (async () => {
      const report = await checkCopilotReadiness(token);
      if (cancelled) return;
      if (report.ok) onReadyRef.current();
      else setPhase({ kind: 'failed', report });
    })();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  useInput((input) => {
    if (phase.kind !== 'failed') return;
    if (input === 'r' || input === 'R') {
      setAttempt((n) => n + 1);
      return;
    }
    if (input === 'c' || input === 'C') {
      onContinueAnyway();
      return;
    }
    if (input === 'q' || input === 'Q') {
      onQuit();
      return;
    }
  });

  if (phase.kind === 'checking') {
    return (
      <Panel
        title="Checking GitHub Copilot"
        subtitle="first-run readiness"
        footer="Verifying you're signed in and Copilot is reachable…"
      >
        <Text>
          <Text color="cyanBright">⠿</Text> Contacting GitHub Copilot…
        </Text>
      </Panel>
    );
  }

  const { token: tok, sdk } = phase.report;
  const hint = !tok.ok ? tok.hint : sdk.hint;

  return (
    <Panel
      title="GitHub Copilot isn't ready yet"
      subtitle="first-run readiness"
      footer="r recheck · c continue anyway · q quit"
      accent="red"
    >
      <Box flexDirection="column">
        <CheckLine check={tok} />
        <CheckLine check={sdk} />
        <Box marginTop={1} flexDirection="column">
          <Text bold>To fix:</Text>
          <Text>
            <Text color="cyanBright">1.</Text> Open another terminal and run:
          </Text>
          <Box marginLeft={3}>
            <Text color="cyanBright">deckpilot auth login</Text>
          </Box>
          <Text>
            <Text color="cyanBright">2.</Text> Complete the GitHub device-flow login.
          </Text>
          <Text>
            <Text color="cyanBright">3.</Text> Come back here and press <Text bold>r</Text> to
            recheck.
          </Text>
          {hint ? <Text dimColor>{hint}</Text> : null}
        </Box>
      </Box>
    </Panel>
  );
};

const CheckLine: React.FC<{ check: { ok: boolean; name: string; detail: string } }> = ({
  check,
}) => (
  <Text>
    <Text color={check.ok ? 'green' : 'red'}>{check.ok ? '✓' : '✗'}</Text> {check.name} —{' '}
    <Text dimColor>{check.detail}</Text>
  </Text>
);

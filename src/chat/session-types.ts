/**
 * Standalone types extracted from session.ts so modules with stricter import
 * boundaries (e.g. the projects store) can consume them without dragging in
 * the full ChatSession class — which transitively imports pptxgenjs.
 */
export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tool: string; status: 'start' | 'done' | 'error'; detail?: string }
  | { kind: 'system'; id: string; text: string };

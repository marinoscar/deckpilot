export class DeckPilotError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'DeckPilotError';
    this.hint = hint;
  }
}

export class AuthError extends DeckPilotError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = 'AuthError';
  }
}

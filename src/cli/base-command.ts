import { Command } from '@oclif/core';
import { DeckPilotError } from '../util/errors.js';

export abstract class BaseCommand extends Command {
  protected fail(message: string, hint?: string): never {
    this.error(hint ? `${message}\n  hint: ${hint}` : message, { exit: 1 });
  }

  protected handle(err: unknown): never {
    if (err instanceof DeckPilotError) this.fail(err.message, err.hint);
    if (err instanceof Error) this.fail(err.message);
    this.fail(String(err));
  }
}

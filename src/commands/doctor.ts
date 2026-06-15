import { BaseCommand } from '../cli/base-command.js';
import { allHardChecksOk, runDoctorChecks } from '../cli/doctor-checks.js';

export default class Doctor extends BaseCommand {
  static override description =
    'Run preflight diagnostics: Node version, Copilot SDK reachable, auth/entitlement, write permissions.';

  static override examples = ['<%= config.bin %> doctor'];

  async run(): Promise<void> {
    const checks = await runDoctorChecks();

    for (const c of checks) {
      const mark = c.ok ? '✓' : c.soft ? '!' : '✗';
      const color = c.ok ? '\x1b[32m' : c.soft ? '\x1b[33m' : '\x1b[31m';
      this.log(`${color}${mark}\x1b[0m ${c.name} — ${c.detail}`);
      if (!c.ok && c.hint) this.log(`    hint: ${c.hint}`);
    }

    // Soft checks don't fail the exit; only hard failures do.
    if (!allHardChecksOk(checks)) this.exit(1);
  }
}

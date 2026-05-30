import { BaseCommand } from '../../cli/base-command.js';
import { summarizeSkill } from '../../skill/spec.js';
import { skillsRoot } from '../../store/paths.js';
import { listSkills } from '../../store/skills.js';

export default class SkillList extends BaseCommand {
  static override description =
    'List all DeckPilot skills (built-in + your own under ~/.deckpilot/skills/).';

  static override examples = ['<%= config.bin %> skill list'];

  async run(): Promise<void> {
    const entries = await listSkills();
    if (entries.length === 0) {
      this.log(`No skills found under ${skillsRoot()}.`);
      this.log('Create one with:');
      this.log('  deckpilot skill create <name>   # writes an annotated SKILL.md to edit');
      return;
    }
    this.log(`Skills (${entries.length}):`);
    for (const e of entries) {
      const tag = e.builtin ? ' (built-in)' : '';
      this.log(`  ${summarizeSkill(e.spec)}${tag}`);
    }
  }
}

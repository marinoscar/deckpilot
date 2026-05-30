import { Args } from '@oclif/core';
import { BaseCommand } from '../../cli/base-command.js';
import { STAGE_PHASE } from '../../skill/spec.js';
import { SkillNotFoundError, loadSkill } from '../../store/skills.js';

export default class SkillShow extends BaseCommand {
  static override description = 'Show a skill: its description, version, and each stage section.';

  static override examples = ['<%= config.bin %> skill show story-arc'];

  static override args = {
    name: Args.string({
      required: true,
      description: 'Skill name (directory under ~/.deckpilot/skills/, or a built-in).',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(SkillShow);
    try {
      const skill = await loadSkill(args.name);
      const tag = skill.builtin ? '  (built-in, read-only)' : '';
      this.log(`Skill "${skill.name}" v${skill.version}${tag}  (${skill.rootDir})`);
      this.log(`  ${skill.description}`);
      this.log(`  stages: ${skill.stages.join(', ')}`);
      for (const stage of skill.stages) {
        this.log('');
        this.log(`## ${stage}   — ${STAGE_PHASE[stage]}`);
        this.log(skill.instructions[stage] ?? '');
      }
    } catch (e) {
      if (e instanceof SkillNotFoundError) this.fail(e.message);
      throw e;
    }
  }
}

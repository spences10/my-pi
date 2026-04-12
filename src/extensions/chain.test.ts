import {
	parseFrontmatter,
	type SkillFrontmatter,
} from '@mariozechner/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ── YAML parser (extracted from chain.ts for testing) ──

interface ChainStep {
	agent: string;
	prompt: string;
}

interface ChainDef {
	name: string;
	description: string;
	steps: ChainStep[];
}

function parse_chain_yaml(raw: string): ChainDef[] {
	const chains: ChainDef[] = [];
	let current: ChainDef | null = null;
	let currentStep: ChainStep | null = null;

	for (const line of raw.split('\n')) {
		const chainMatch = line.match(/^(\S[^:]*):$/);
		if (chainMatch) {
			if (current && currentStep) {
				current.steps.push(currentStep);
				currentStep = null;
			}
			current = {
				name: chainMatch[1].trim(),
				description: '',
				steps: [],
			};
			chains.push(current);
			continue;
		}

		const descMatch = line.match(/^\s+description:\s+(.+)$/);
		if (descMatch && current && !currentStep) {
			let desc = descMatch[1].trim();
			if (
				(desc.startsWith('"') && desc.endsWith('"')) ||
				(desc.startsWith("'") && desc.endsWith("'"))
			) {
				desc = desc.slice(1, -1);
			}
			current.description = desc;
			continue;
		}

		if (line.match(/^\s+steps:\s*$/) && current) continue;

		const agentMatch = line.match(/^\s+-\s+agent:\s+(.+)$/);
		if (agentMatch && current) {
			if (currentStep) current.steps.push(currentStep);
			currentStep = {
				agent: agentMatch[1].trim(),
				prompt: '',
			};
			continue;
		}

		const promptMatch = line.match(/^\s+prompt:\s+(.+)$/);
		if (promptMatch && currentStep) {
			let prompt = promptMatch[1].trim();
			if (
				(prompt.startsWith('"') && prompt.endsWith('"')) ||
				(prompt.startsWith("'") && prompt.endsWith("'"))
			) {
				prompt = prompt.slice(1, -1);
			}
			prompt = prompt.replace(/\\n/g, '\n');
			currentStep.prompt = prompt;
			continue;
		}
	}

	if (current && currentStep) {
		current.steps.push(currentStep);
	}

	return chains;
}

describe('parse_chain_yaml', () => {
	it('parses the project chain config', () => {
		const raw = readFileSync(
			join(process.cwd(), '.pi', 'agents', 'agent-chain.yaml'),
			'utf-8',
		);
		const chains = parse_chain_yaml(raw);

		expect(chains.length).toBeGreaterThanOrEqual(2);
		expect(chains[0].name).toBe('scout-plan');
		expect(chains[0].steps).toHaveLength(2);
		expect(chains[0].steps[0].agent).toBe('scout');
		expect(chains[0].steps[1].agent).toBe('planner');
	});

	it('parses descriptions', () => {
		const yaml = `my-chain:
  description: "A test chain"
  steps:
    - agent: builder
      prompt: "Build: $INPUT"`;

		const chains = parse_chain_yaml(yaml);
		expect(chains).toHaveLength(1);
		expect(chains[0].description).toBe('A test chain');
	});

	it('parses multiple chains', () => {
		const yaml = `chain-a:
  description: "First"
  steps:
    - agent: scout
      prompt: "$INPUT"

chain-b:
  description: "Second"
  steps:
    - agent: builder
      prompt: "$INPUT"
    - agent: reviewer
      prompt: "$INPUT"`;

		const chains = parse_chain_yaml(yaml);
		expect(chains).toHaveLength(2);
		expect(chains[0].name).toBe('chain-a');
		expect(chains[0].steps).toHaveLength(1);
		expect(chains[1].name).toBe('chain-b');
		expect(chains[1].steps).toHaveLength(2);
	});

	it('handles escaped newlines in prompts', () => {
		const yaml = `test:
  steps:
    - agent: planner
      prompt: "Plan:\\n\\n$INPUT"`;

		const chains = parse_chain_yaml(yaml);
		expect(chains[0].steps[0].prompt).toBe('Plan:\n\n$INPUT');
	});

	it('handles single-quoted values', () => {
		const yaml = `test:
  description: 'My description'
  steps:
    - agent: scout
      prompt: 'Do: $INPUT'`;

		const chains = parse_chain_yaml(yaml);
		expect(chains[0].description).toBe('My description');
		expect(chains[0].steps[0].prompt).toBe('Do: $INPUT');
	});

	it('returns empty array for empty input', () => {
		expect(parse_chain_yaml('')).toHaveLength(0);
	});
});

describe('agent definition parsing', () => {
	it('parses agent markdown frontmatter', () => {
		const raw = readFileSync(
			join(process.cwd(), '.pi', 'agents', 'scout.md'),
			'utf-8',
		);
		const { frontmatter, body } =
			parseFrontmatter<SkillFrontmatter>(raw);

		expect(frontmatter?.name).toBe('scout');
		expect(frontmatter?.description).toBe(
			'Codebase exploration and analysis',
		);
		expect(body.trim()).toContain('scout agent');
	});

	it('parses tools from frontmatter', () => {
		const raw = readFileSync(
			join(process.cwd(), '.pi', 'agents', 'planner.md'),
			'utf-8',
		);
		const { frontmatter } = parseFrontmatter<
			SkillFrontmatter & { tools?: string }
		>(raw);

		expect(frontmatter?.tools).toBe('read,grep,find,ls');
	});
});

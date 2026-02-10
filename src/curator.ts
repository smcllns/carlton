import { join } from "path";
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { getProjectRoot, getReportsDir } from "./config.ts";
import type { PromptConfig } from "./prompt.ts";

export async function runCurator(date: string, prompt: PromptConfig): Promise<boolean> {
  const projectRoot = getProjectRoot();
  const dateDir = join(getReportsDir(), date);
  const researchDir = join(dateDir, "research");
  mkdirSync(dateDir, { recursive: true });

  const researchFiles = readdirSync(researchDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (researchFiles.length === 0) {
    throw new Error(`No research files found in ${researchDir}`);
  }

  const researchContent = researchFiles
    .map((f) => {
      const content = readFileSync(join(researchDir, f), "utf8");
      return `### ${f}\n\n${content}`;
    })
    .join("\n\n---\n\n");

  const systemLine = prompt.system ? `${prompt.system}\n\n` : "";
  const curatorPrompt = `${systemLine}You are a curator compiling a daily briefing email from research notes.

## Briefing Format
${prompt.briefingFormat}

## Research Notes
${researchContent}

## Instructions
Compile the research above into a single briefing email following the format specified.
Output only the briefing markdown — no preamble, no explanation.`;

  console.log(`Running curator for ${date}...`);

  const proc = Bun.spawn(
    ["claude", "-p", curatorPrompt, "--model", "sonnet"],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );

  const timeout = setTimeout(() => proc.kill(), 120_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    console.error(`Curator failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
    return false;
  }

  const briefingPath = join(dateDir, "briefing.md");
  writeFileSync(briefingPath, stdout, "utf8");
  console.log(`Briefing written to reports/${date}/briefing.md`);
  return true;
}

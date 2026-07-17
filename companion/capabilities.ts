import { spawn } from 'node:child_process';
import type { DetectedTool, DetectedTools } from './contracts.js';

interface ToolCandidate {
  command: string;
  args: string[];
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160);
}

async function probeCandidate(candidate: ToolCandidate): Promise<DetectedTool> {
  return await new Promise((resolve) => {
    const child = spawn(candidate.command, candidate.args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      if (output.length < 4_096) output += chunk.toString('utf8', 0, 4_096 - output.length);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 4_000);
    timeout.unref();
    child.once('error', () => {
      clearTimeout(timeout);
      resolve({ available: false });
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(
        code === 0
          ? { available: true, command: candidate.command, version: firstNonEmptyLine(output) }
          : { available: false },
      );
    });
  });
}

async function detect(candidates: ToolCandidate[]): Promise<DetectedTool> {
  for (const candidate of candidates) {
    const result = await probeCandidate(candidate);
    if (result.available) return result;
  }
  return { available: false };
}

function commandCandidates(
  configured: string | undefined,
  fallbackCommand: string,
  args: string[],
  extraCommands: string[] = [],
): ToolCandidate[] {
  return [configured, fallbackCommand, ...extraCommands]
    .filter((command): command is string => Boolean(command?.trim()))
    .filter((command, index, all) => all.indexOf(command) === index)
    .map((command) => ({ command, args }));
}

export async function detectTools(): Promise<DetectedTools> {
  const [ffmpeg, ffprobe, libreoffice, poppler] = await Promise.all([
    detect(
      commandCandidates(
        process.env.FORMAT_FORGE_FFMPEG_PATH ?? process.env.FFMPEG_PATH,
        'ffmpeg',
        ['-version'],
      ),
    ),
    detect(
      commandCandidates(
        process.env.FORMAT_FORGE_FFPROBE_PATH ?? process.env.FFPROBE_PATH,
        'ffprobe',
        ['-version'],
      ),
    ),
    detect(
      commandCandidates(
        process.env.FORMAT_FORGE_SOFFICE_PATH ?? process.env.LIBREOFFICE_PATH,
        'soffice',
        ['--version'],
        ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
      ),
    ),
    detect(
      commandCandidates(
        process.env.FORMAT_FORGE_PDFTOPPM_PATH ?? process.env.PDFTOPPM_PATH,
        'pdftoppm',
        ['-v'],
      ),
    ),
  ]);

  if (ffmpeg.available) {
    ffmpeg.detail = ffprobe.available
      ? 'ffprobe available for duration-based progress'
      : 'ffprobe unavailable; conversion progress will be approximate';
  }
  return { ffmpeg, ffprobe, libreoffice, poppler };
}

export function publicToolCapability(tool: DetectedTool): Omit<DetectedTool, 'command'> {
  const { command: _command, ...publicFields } = tool;
  return publicFields;
}

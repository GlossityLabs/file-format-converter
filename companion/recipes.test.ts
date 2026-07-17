import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RECIPES,
  ffmpegOutputArguments,
  findRecipe,
  libreOfficeFilter,
} from './recipes.js';

describe('native recipe allowlist', () => {
  it('includes intended office, audio, and video routes', () => {
    expect(findRecipe('docx', 'pdf')?.requires).toBe('libreoffice');
    expect(findRecipe('txt', 'pdf')?.requires).toBe('libreoffice');
    expect(findRecipe('xlsx', 'ods')?.requires).toBe('libreoffice');
    expect(findRecipe('mp4', 'mp3')?.requires).toBe('ffmpeg');
    expect(findRecipe('gif', 'webm')?.requires).toBe('ffmpeg');
  });

  it('rejects routes outside the explicit allowlist', () => {
    expect(findRecipe('pdf', 'docx')).toBeUndefined();
    expect(findRecipe('mp3', 'mp4')).toBeUndefined();
    expect(findRecipe('docx', 'mp3')).toBeUndefined();
    expect(ALLOWED_RECIPES.every((recipe) => recipe.input !== recipe.output)).toBe(true);
  });

  it('builds native argument fragments without shell command strings', () => {
    expect(libreOfficeFilter('docx')).toContain('Office Open XML');
    expect(ffmpegOutputArguments('mp3', 'balanced')).toEqual([
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
    ]);
    expect(ffmpegOutputArguments('mp4', 'small')).toContain('30');
  });
});

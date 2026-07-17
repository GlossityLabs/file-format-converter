import { describe, expect, it } from 'vitest';
import type { CompanionCapabilities } from './types';
import { BROWSER_RECIPES, COMPANION_RECIPES, findRecipe, getAvailableRecipes } from './recipes';

const capabilities: CompanionCapabilities = {
  service: 'format-forge-companion',
  version: 'test',
  paired: true,
  tools: {
    ffmpeg: { available: true },
    libreoffice: { available: false },
    poppler: { available: false },
  },
};

describe('conversion recipes', () => {
  it('advertises only the exact browser conversion matrix', () => {
    expect(BROWSER_RECIPES).toHaveLength(13);
    expect(findRecipe('jpg', 'png')?.engine).toBe('browser');
    expect(findRecipe('webp', 'pdf')?.engine).toBe('browser');
    expect(findRecipe('pdf', 'jpg')?.engine).toBe('browser');
    expect(findRecipe('csv', 'json')?.engine).toBe('browser');
    expect(findRecipe('pdf', 'docx')).toBeUndefined();
  });

  it('contains the requested companion routes without broad cross-category claims', () => {
    expect(COMPANION_RECIPES).toHaveLength(104);
    expect(findRecipe('txt', 'pdf')?.requires).toBe('libreoffice');
    expect(findRecipe('xlsx', 'csv')?.requires).toBe('libreoffice');
    expect(findRecipe('gif', 'mp4')?.requires).toBe('ffmpeg');
    expect(findRecipe('gif', 'mp3')).toBeUndefined();
    expect(findRecipe('mp4', 'mp3')?.requires).toBe('ffmpeg');
  });

  it('filters companion routes by pairing and detected tool capability', () => {
    const available = getAvailableRecipes(capabilities);
    expect(available).toContainEqual(expect.objectContaining({ input: 'mp4', output: 'webm' }));
    expect(available).not.toContainEqual(expect.objectContaining({ input: 'docx', output: 'pdf' }));
    expect(getAvailableRecipes({ ...capabilities, paired: false })).toEqual(BROWSER_RECIPES);
  });
});

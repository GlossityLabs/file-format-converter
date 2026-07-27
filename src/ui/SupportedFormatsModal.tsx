import { Info, Laptop, LockKeyhole } from 'lucide-react';
import { CONVERSION_RECIPES } from '../core/recipes';
import type { ConversionRecipe, FormatId } from '../core/types';
import { FormatIcon } from './FormatIcon';
import { FORMAT_GROUPS, FORMAT_LABELS, getFormatCategory } from './formatData';
import { Modal } from './Modal';

interface SupportedFormatsModalProps {
  open: boolean;
  onClose: () => void;
}

const ENGINE_GROUPS: readonly { engine: ConversionRecipe['engine']; label: string }[] = [
  { engine: 'browser', label: 'Handled in Chrome' },
  { engine: 'companion', label: 'Local Engine · macOS only' },
];

export function SupportedFormatsModal({ open, onClose }: SupportedFormatsModalProps) {
  const recipeGroups = FORMAT_GROUPS.map((group) => {
    const recipes = CONVERSION_RECIPES.filter((recipe) => getFormatCategory(recipe.input) === group.category);
    const inputs = [...new Set(recipes.map((recipe) => recipe.input))];
    return {
      group,
      rows: inputs.map((input) => ({ input, recipes: recipes.filter((recipe) => recipe.input === input) })),
    };
  }).filter(({ rows }) => rows.length > 0);

  function outputLabel(input: FormatId, recipe: ConversionRecipe): string {
    const label = FORMAT_LABELS[recipe.output];
    return input === 'pdf' && (recipe.output === 'png' || recipe.output === 'jpg') ? `${label} (ZIP)` : label;
  }

  return (
    <Modal open={open} onClose={onClose} title="Supported file conversions" eyebrow="Input → output" size="wide">
      <p className="formats-intro">
        Every output below shows where the conversion happens. Conversions marked <strong>Handled in Chrome</strong> work without the Local Engine.
      </p>
      <div className="platform-note">
        <Laptop size={19} aria-hidden="true" />
        <p>
          <strong>The Local Engine is currently supported on macOS only.</strong>
          It is a Mac developer preview used for Office, audio and video conversion. Windows and Linux are not supported yet.
        </p>
      </div>
      <div className="recipe-legend" aria-label="Conversion engine legend">
        <span><i className="recipe-dot recipe-dot--browser" /> Handled in Chrome — no installation needed</span>
        <span><i className="recipe-dot recipe-dot--companion" /> Local Engine — macOS only</span>
      </div>
      <div className="formats-grid">
        {recipeGroups.map(({ group, rows }) => (
          <section className="format-group" key={group.category} aria-labelledby={`format-${group.category}`}>
            <div className="format-group__header">
              <FormatIcon category={group.category} size={20} />
              <div>
                <h3 id={`format-${group.category}`}>{group.label}</h3>
                <p>{group.description}</p>
              </div>
            </div>
            <div className="recipe-matrix">
              {rows.map(({ input, recipes }) => (
                <div className="recipe-row" key={input}>
                  <strong>{FORMAT_LABELS[input]}</strong>
                  <span className="recipe-arrow" aria-hidden="true">→</span>
                  <div className="recipe-outputs">
                    {ENGINE_GROUPS.map(({ engine, label }) => {
                      const engineRecipes = recipes.filter((recipe) => recipe.engine === engine);
                      if (engineRecipes.length === 0) return null;
                      return (
                        <div
                          className={`recipe-output-group recipe-output-group--${engine}`}
                          key={engine}
                          role="group"
                          aria-label={`${label} outputs from ${FORMAT_LABELS[input]}`}
                        >
                          <span className="recipe-engine-label">{label}</span>
                          <div className="recipe-output-values">
                            {engineRecipes.map((recipe) => (
                              <span
                                className={`recipe-output recipe-output--${recipe.engine}`}
                                key={`${recipe.input}-${recipe.output}`}
                                title={`${FORMAT_LABELS[input]} to ${outputLabel(input, recipe)} — ${label}`}
                              >
                                {outputLabel(input, recipe)}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="fidelity-note">
        <Info size={18} aria-hidden="true" />
        <p><strong>A note on fidelity</strong> Office layout depends on fonts installed on this computer. Format Forge preserves structure where possible and never sends a file out to repair it.</p>
      </div>
      <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> Both methods keep the source and result on your device; neither uploads files to Glossity Labs.</p>
      <div className="modal-actions">
        <button className="button button--primary" type="button" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}

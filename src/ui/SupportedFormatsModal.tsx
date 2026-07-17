import { Info, LockKeyhole } from 'lucide-react';
import { CONVERSION_RECIPES } from '../core/recipes';
import type { ConversionRecipe, FormatId } from '../core/types';
import { FormatIcon } from './FormatIcon';
import { FORMAT_GROUPS, FORMAT_LABELS, getFormatCategory } from './formatData';
import { Modal } from './Modal';

interface SupportedFormatsModalProps {
  open: boolean;
  onClose: () => void;
}

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
        See exactly what each file type can become. Image, PDF, CSV and JSON conversions run in Chrome; Office, audio and video use the optional local desktop helper.
      </p>
      <div className="recipe-legend" aria-label="Conversion engine legend">
        <span><i className="recipe-dot recipe-dot--browser" /> In extension</span>
        <span><i className="recipe-dot recipe-dot--companion" /> Local companion</span>
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
                    {recipes.map((recipe) => (
                      <span
                        className={`recipe-output recipe-output--${recipe.engine}`}
                        key={`${recipe.input}-${recipe.output}`}
                        title={recipe.engine === 'browser' ? 'Runs inside the extension' : 'Uses the local companion'}
                      >
                        {outputLabel(input, recipe)}
                      </span>
                    ))}
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
      <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> “Local” means every source and result stays on this device.</p>
      <div className="modal-actions">
        <button className="button button--primary" type="button" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}

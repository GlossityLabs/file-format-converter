import { ArrowUpRight, FileKey2 } from 'lucide-react';
import { FormatIcon } from './FormatIcon';
import { FORMAT_GROUPS } from './formatData';

export function EmptyFormats({ onShowFormats }: { onShowFormats: () => void }) {
  const featured = FORMAT_GROUPS.filter((group) => ['document', 'image', 'audio', 'video'].includes(group.category));
  return (
    <section className="format-preview" aria-labelledby="format-preview-title">
      <header className="format-preview__header">
        <div>
          <p className="eyebrow">One tidy workspace</p>
          <h2 id="format-preview-title">Built for the files you actually use</h2>
        </div>
        <button className="text-button" type="button" onClick={onShowFormats}>
          See all supported formats
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="preview-grid">
        {featured.map((group) => (
          <article className="preview-card" key={group.category}>
            <FormatIcon category={group.category} size={22} />
            <div>
              <h3>{group.label}</h3>
              <p>{group.description}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="local-proof">
        <span aria-hidden="true"><FileKey2 size={20} /></span>
        <div>
          <strong>No cloud upload. No cloud history.</strong>
          <p>Conversion happens in this extension or through the companion app on your computer.</p>
        </div>
      </div>
    </section>
  );
}

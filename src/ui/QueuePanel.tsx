import { CheckCheck, Download, Eye, Play, Trash2 } from 'lucide-react';
import { findRecipe, isRecipeAvailable } from '../core/recipes';
import type { CompanionCapabilities, ConversionJob, FormatId, QualityPreset } from '../core/types';
import { JobCard } from './JobCard';
import { pluralize } from './formatData';

interface QueuePanelProps {
  jobs: ConversionJob[];
  capabilities: CompanionCapabilities | null;
  isConverting: boolean;
  overallProgress: number;
  onUpdateOutput: (id: string, format: FormatId) => void;
  onUpdatePreset: (id: string, preset: QualityPreset) => void;
  onStart: (id: string) => void;
  onConvertAll: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  onDownloadAll: () => void;
  onClearCompleted: () => void;
}

export function QueuePanel({
  jobs,
  capabilities,
  isConverting,
  overallProgress,
  onUpdateOutput,
  onUpdatePreset,
  onStart,
  onConvertAll,
  onCancel,
  onRetry,
  onRemove,
  onDownload,
  onDownloadAll,
  onClearCompleted,
}: QueuePanelProps) {
  if (jobs.length === 0) return null;

  const readyCount = jobs.filter((job) => {
    if (job.status !== 'ready') return false;
    const recipe = findRecipe(job.inputFormat, job.outputFormat);
    return Boolean(recipe && isRecipeAvailable(recipe, capabilities));
  }).length;
  const completeCount = jobs.filter((job) => job.status === 'complete').length;
  const clampedProgress = Math.max(0, Math.min(100, Math.round(overallProgress)));

  return (
    <section className="queue-panel" aria-labelledby="queue-heading">
      <header className="queue-header">
        <div>
          <div className="queue-title-row">
            <h2 id="queue-heading">Conversion queue</h2>
            <span className="count-badge">{jobs.length}</span>
          </div>
          <p>{isConverting ? `${clampedProgress}% across this queue` : `${pluralize(readyCount, 'file')} ready to convert`}</p>
        </div>
        <div className="queue-header__actions">
          {completeCount > 1 ? (
            <button className="button button--secondary" type="button" onClick={onDownloadAll}>
              <Download size={16} aria-hidden="true" />
              Download all
            </button>
          ) : null}
          {completeCount > 0 ? (
            <button className="button button--quiet" type="button" onClick={onClearCompleted}>
              <Trash2 size={15} aria-hidden="true" />
              Clear finished
            </button>
          ) : null}
          {readyCount > 0 ? (
            <button className="button button--primary" type="button" onClick={onConvertAll} disabled={isConverting}>
              {readyCount > 1 ? <CheckCheck size={17} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
              Convert {readyCount > 1 ? `all ${readyCount}` : 'file'}
            </button>
          ) : null}
        </div>
      </header>

      {isConverting ? (
        <div className="overall-progress">
          <div className="keep-open-note" role="status">
            <Eye size={15} aria-hidden="true" />
            <span><strong>Keep this tab open</strong> while your queue is converting.</span>
          </div>
          <div className="progress-track" role="progressbar" aria-label="Overall queue progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clampedProgress}>
            <span style={{ width: `${clampedProgress}%` }} />
          </div>
        </div>
      ) : null}

      <div className="job-list">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            capabilities={capabilities}
            onUpdateOutput={onUpdateOutput}
            onUpdatePreset={onUpdatePreset}
            onStart={onStart}
            onCancel={onCancel}
            onRetry={onRetry}
            onRemove={onRemove}
            onDownload={onDownload}
          />
        ))}
      </div>
    </section>
  );
}

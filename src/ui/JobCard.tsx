import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { ConversionJob, FormatId, QualityPreset } from '../core/types';
import { FormatIcon } from './FormatIcon';
import {
  FORMAT_LABELS,
  PRESET_LABELS,
  STATUS_LABELS,
  formatFileSize,
  getOutputFormats,
} from './formatData';

interface JobCardProps {
  job: ConversionJob;
  onUpdateOutput: (id: string, format: FormatId) => void;
  onUpdatePreset: (id: string, preset: QualityPreset) => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
}

const ACTIVE_STATUSES = new Set<ConversionJob['status']>(['uploading', 'converting', 'finalizing']);

export function JobCard({
  job,
  onUpdateOutput,
  onUpdatePreset,
  onStart,
  onCancel,
  onRetry,
  onRemove,
  onDownload,
}: JobCardProps) {
  const isActive = ACTIVE_STATUSES.has(job.status);
  const canConfigure = job.status === 'ready' || job.status === 'failed' || job.status === 'canceled';
  const outputOptions = getOutputFormats(job.inputFormat, job.outputFormat);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(job.progress)));
  const fileMeta = `${FORMAT_LABELS[job.inputFormat]} · ${formatFileSize(job.file.size)}`;

  return (
    <article className={`job-card job-card--${job.status}`} aria-label={`${job.file.name}, ${STATUS_LABELS[job.status]}`}>
      <div className="job-card__main">
        <FormatIcon format={job.inputFormat} size={23} />
        <div className="job-card__identity">
          <h3 title={job.file.name}>{job.file.name}</h3>
          <p>{fileMeta}</p>
        </div>

        <div className="format-route" aria-label={`Convert ${FORMAT_LABELS[job.inputFormat]} to ${FORMAT_LABELS[job.outputFormat]}`}>
          <span>{FORMAT_LABELS[job.inputFormat]}</span>
          <ArrowRight size={15} aria-hidden="true" />
          <span className="format-route__output">{FORMAT_LABELS[job.outputFormat]}</span>
        </div>

        <div className="job-status" role="status" aria-live="polite">
          {job.status === 'complete' ? <Check size={15} aria-hidden="true" /> : null}
          {job.status === 'failed' ? <TriangleAlert size={15} aria-hidden="true" /> : null}
          {job.status === 'canceled' ? <X size={15} aria-hidden="true" /> : null}
          {isActive ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
          <span>{STATUS_LABELS[job.status]}</span>
        </div>
      </div>

      {canConfigure ? (
        <div className="job-card__controls">
          <label className="select-field">
            <span>Convert to</span>
            <select
              value={job.outputFormat}
              onChange={(event) => onUpdateOutput(job.id, event.target.value as FormatId)}
              aria-label={`Output format for ${job.file.name}`}
            >
              {outputOptions.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field select-field--quality">
            <span>Preset</span>
            <select
              value={job.preset}
              onChange={(event) => onUpdatePreset(job.id, event.target.value as QualityPreset)}
              aria-label={`Quality preset for ${job.file.name}`}
            >
              {(Object.keys(PRESET_LABELS) as QualityPreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset].label}
                </option>
              ))}
            </select>
          </label>
          <span className="engine-label" title={job.engine === 'browser' ? 'Processed inside this extension' : 'Processed by the companion app on this device'}>
            <ShieldCheck size={14} aria-hidden="true" />
            {job.engine === 'browser' ? 'In browser' : 'Local engine'}
          </span>
        </div>
      ) : null}

      {isActive ? (
        <div className="job-progress">
          <div className="progress-copy">
            <span>{STATUS_LABELS[job.status]}</span>
            <span>{clampedProgress}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`Conversion progress for ${job.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedProgress}
          >
            <span style={{ width: `${clampedProgress}%` }} />
          </div>
        </div>
      ) : null}

      {job.error && job.status === 'failed' ? <p className="job-error">{job.error}</p> : null}

      <div className="job-card__actions">
        {job.status === 'ready' ? (
          <button className="button button--small button--dark" type="button" onClick={() => onStart(job.id)}>
            <Play size={14} fill="currentColor" aria-hidden="true" />
            Convert
          </button>
        ) : null}
        {isActive ? (
          <button className="button button--small button--ghost" type="button" onClick={() => onCancel(job.id)}>
            <Square size={13} fill="currentColor" aria-hidden="true" />
            Cancel
          </button>
        ) : null}
        {job.status === 'failed' || job.status === 'canceled' ? (
          <button className="button button--small button--dark" type="button" onClick={() => onRetry(job.id)}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        ) : null}
        {job.status === 'complete' ? (
          <button className="button button--small button--dark" type="button" onClick={() => onDownload(job.id)}>
            <Download size={15} aria-hidden="true" />
            Download
          </button>
        ) : null}
        {!isActive ? (
          <button className="icon-button icon-button--subtle" type="button" onClick={() => onRemove(job.id)} aria-label={`Remove ${job.file.name}`} title="Remove from queue">
            <Trash2 size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

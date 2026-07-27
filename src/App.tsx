import {
  ArrowDown,
  ArrowRight,
  LockKeyhole,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormatId } from './core/types';
import { useConversionQueue } from './hooks/useConversionQueue';
import { CompanionPanel, CompanionStatusButton } from './ui/CompanionPanel';
import { DropZone } from './ui/DropZone';
import { EmptyFormats } from './ui/EmptyFormats';
import { FormatIcon } from './ui/FormatIcon';
import { FORMAT_LABELS } from './ui/formatData';
import { QueuePanel } from './ui/QueuePanel';
import { SupportedFormatsModal } from './ui/SupportedFormatsModal';

const HERO_CONVERSION_EXAMPLES: readonly {
  input: FormatId;
  output: FormatId;
  engine: 'browser' | 'local';
  engineLabel: string;
}[] = [
  { input: 'docx', output: 'pdf', engine: 'local', engineLabel: 'Local Engine · Mac' },
  { input: 'png', output: 'webp', engine: 'browser', engineLabel: 'Handled in Chrome' },
  { input: 'mp4', output: 'mp3', engine: 'local', engineLabel: 'Local Engine · Mac' },
  { input: 'csv', output: 'json', engine: 'browser', engineLabel: 'Handled in Chrome' },
];

export default function App() {
  const {
    jobs,
    addFiles,
    updateOutput,
    updatePreset,
    removeJob,
    convertAll,
    startJob,
    cancelJob,
    retryJob,
    clearCompleted,
    downloadJob,
    downloadAll,
    isConverting,
    overallProgress,
    companion,
    queueError,
    clearQueueError,
  } = useConversionQueue();
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const shouldWarnBeforeLeaving = jobs.length > 0;

  useEffect(() => {
    if (!shouldWarnBeforeLeaving) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [shouldWarnBeforeLeaving]);

  function handleFiles(files: File[]) {
    setAnnouncement(`Adding ${files.length} ${files.length === 1 ? 'file' : 'files'} to the conversion queue.`);
    void addFiles(files)
      .then(() => setAnnouncement(`${files.length} ${files.length === 1 ? 'file was' : 'files were'} added to the conversion queue.`))
      .catch(() => setAnnouncement('Some files could not be added. Review the message above the queue.'));
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to converter</a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#top" aria-label="Format Forge file format converter home">
            <img src="/icons/brand.svg" alt="" width="40" height="40" />
            <span>
              <strong className="brand-wordmark">
                <span>Format</span><span className="brand-wordmark__accent"> Forge</span><i aria-hidden="true" />
              </strong>
              <small>Local file converter</small>
            </span>
          </a>
          <nav className="header-nav" aria-label="Primary navigation">
            <button className="nav-button" type="button" onClick={() => setFormatsOpen(true)}>Formats</button>
            <span className="privacy-chip"><ShieldCheck size={14} aria-hidden="true" /> Local only</span>
            <CompanionStatusButton companion={companion} onClick={() => setPairingOpen(true)} />
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__glow hero__glow--one" aria-hidden="true" />
          <div className="hero__glow hero__glow--two" aria-hidden="true" />
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow eyebrow--light">Documents · Images · Audio · Video</p>
              <h1 id="hero-title">Convert file formats.<br /><span>Keep files on your Mac.</span></h1>
              <p className="hero-lede">Turn DOCX into PDF, MP4 into MP3 or GIF, PNG into JPG or WebP, PDF pages into images, and CSV into JSON—without cloud uploads.</p>
              <a className="button button--lime hero-cta" href="#workspace">
                Choose files to convert
                <ArrowDown size={17} aria-hidden="true" />
              </a>
              <div className="hero-chips" aria-label="Popular file conversions">
                <span><b>DOCX</b> → PDF</span>
                <span><b>PNG</b> → JPG</span>
                <span><b>MP4</b> → MP3</span>
              </div>
            </div>
            <aside className="privacy-story conversion-showcase" aria-labelledby="conversion-showcase-title">
              <div className="conversion-showcase__heading">
                <div>
                  <p>Popular conversions</p>
                  <h2 id="conversion-showcase-title">See one format become another</h2>
                </div>
                <span className="conversion-showcase__privacy"><ShieldCheck size={14} aria-hidden="true" /> Files stay local</span>
              </div>
              <div className="conversion-showcase__list">
                {HERO_CONVERSION_EXAMPLES.map(({ input, output, engine, engineLabel }) => (
                  <div className="conversion-example" key={`${input}-${output}`}>
                    <div className="conversion-format">
                      <FormatIcon format={input} size={20} />
                      <span>
                        <small>From</small>
                        <strong>{FORMAT_LABELS[input]}</strong>
                      </span>
                    </div>
                    <div className={`conversion-route conversion-route--${engine}`} aria-label={`Uses ${engineLabel}`}>
                      <ArrowRight size={18} aria-hidden="true" />
                      <small>{engineLabel}</small>
                    </div>
                    <div className="conversion-format conversion-format--output">
                      <FormatIcon format={output} size={20} />
                      <span>
                        <small>To</small>
                        <strong>{FORMAT_LABELS[output]}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <div id="workspace" className="workspace" tabIndex={-1}>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">File format converter · local workspace</p>
              <h2>Choose a file. Choose a new format.</h2>
            </div>
            <p>DOCX → PDF · MP4 → MP3 · PNG → JPG · and more</p>
          </div>

          {queueError ? (
            <div className="error-banner" role="alert">
              <span>{queueError}</span>
              <button className="icon-button" type="button" onClick={clearQueueError} aria-label="Dismiss error">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <DropZone onFiles={handleFiles} disabled={jobs.length >= 20} />
          <CompanionPanel
            companion={companion}
            modalOpen={pairingOpen}
            onOpenModal={() => setPairingOpen(true)}
            onCloseModal={() => setPairingOpen(false)}
          />
          <QueuePanel
            jobs={jobs}
            capabilities={companion.capabilities}
            isConverting={isConverting}
            overallProgress={overallProgress}
            onUpdateOutput={updateOutput}
            onUpdatePreset={updatePreset}
            onStart={(id) => void startJob(id)}
            onConvertAll={() => void convertAll()}
            onCancel={cancelJob}
            onRetry={(id) => void retryJob(id)}
            onRemove={removeJob}
            onDownload={downloadJob}
            onDownloadAll={() => void downloadAll()}
            onClearCompleted={clearCompleted}
          />
          {jobs.length === 0 ? <EmptyFormats onShowFormats={() => setFormatsOpen(true)} /> : null}
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <img src="/icons/brand.svg" alt="" width="32" height="32" />
            <span>
              <strong className="brand-wordmark">
                <span>Format</span><span className="brand-wordmark__accent"> Forge</span><i aria-hidden="true" />
              </strong>
              <small>A Glossity Labs file converter</small>
            </span>
          </div>
          <div className="footer-links" aria-label="Format Forge information">
            <button className="text-button text-button--footer" type="button" onClick={() => setFormatsOpen(true)}>Supported formats</button>
            <a className="text-button text-button--footer" href="https://github.com/GlossityLabs/file-format-converter/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy</a>
            <a className="text-button text-button--footer" href="/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Open-source licenses</a>
          </div>
          <p><LockKeyhole size={13} aria-hidden="true" /> Local file conversion. No cloud upload.</p>
        </div>
      </footer>

      <SupportedFormatsModal open={formatsOpen} onClose={() => setFormatsOpen(false)} />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  );
}

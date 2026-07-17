import {
  ArrowDown,
  ArrowRight,
  FileCheck2,
  Files,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConversionQueue } from './hooks/useConversionQueue';
import { CompanionPanel, CompanionStatusButton } from './ui/CompanionPanel';
import { DropZone } from './ui/DropZone';
import { EmptyFormats } from './ui/EmptyFormats';
import { QueuePanel } from './ui/QueuePanel';
import { SupportedFormatsModal } from './ui/SupportedFormatsModal';

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
          <a className="brand" href="#top" aria-label="Format Forge home">
            <img src="/icons/brand.svg" alt="" width="40" height="40" />
            <span>
              <strong className="brand-wordmark">
                <span>Format</span><span className="brand-wordmark__accent"> Forge</span><i aria-hidden="true" />
              </strong>
              <small>by Glossity Labs</small>
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
              <p className="eyebrow eyebrow--light">Private by architecture · local-first</p>
              <h1 id="hero-title">Convert the file.<br /><span>Keep it on your Mac.</span></h1>
              <p className="hero-lede">Documents, images, audio and video—converted in your browser or through your private desktop engine. Nothing leaves your device.</p>
              <a className="button button--lime hero-cta" href="#workspace">
                Open private workspace
                <ArrowDown size={17} aria-hidden="true" />
              </a>
              <div className="hero-chips" aria-label="Privacy highlights">
                <span><b>0 bytes</b> to the cloud</span>
                <span><b>Loopback</b> companion</span>
                <span>No account. <b>Ever.</b></span>
              </div>
            </div>
            <aside className="privacy-story" aria-label="How Format Forge protects your files">
              <div className="privacy-story__top">
                <span className="privacy-lock"><LockKeyhole size={22} aria-hidden="true" /></span>
                <div>
                  <p>Local workflow</p>
                  <strong>Your file has no trip to make.</strong>
                </div>
              </div>
              <div className="privacy-flow" aria-hidden="true">
                <span><Files size={19} /></span>
                <i><ArrowRight size={15} /></i>
                <span className="privacy-flow__active"><Sparkles size={19} /></span>
                <i><ArrowRight size={15} /></i>
                <span><FileCheck2 size={19} /></span>
              </div>
              <div className="privacy-story__facts">
                <span><ShieldCheck size={15} aria-hidden="true" /> 0 bytes to cloud</span>
                <span><ShieldCheck size={15} aria-hidden="true" /> Loopback only</span>
                <span><ShieldCheck size={15} aria-hidden="true" /> No file history</span>
              </div>
            </aside>
          </div>
        </section>

        <div id="workspace" className="workspace" tabIndex={-1}>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Converter · local workspace</p>
              <h2>Drop it here. Choose what comes out.</h2>
            </div>
            <p>Mix file types. Set each output. Convert together.</p>
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
              <small>A Glossity Labs local tool</small>
            </span>
          </div>
          <div className="footer-links" aria-label="Format Forge information">
            <button className="text-button text-button--footer" type="button" onClick={() => setFormatsOpen(true)}>Supported formats</button>
            <a className="text-button text-button--footer" href="https://github.com/GlossityLabs/file-format-converter/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Privacy</a>
            <a className="text-button text-button--footer" href="/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Open-source licenses</a>
          </div>
          <p><LockKeyhole size={13} aria-hidden="true" /> Built for local, private conversion</p>
        </div>
      </footer>

      <SupportedFormatsModal open={formatsOpen} onClose={() => setFormatsOpen(false)} />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  );
}

import {
  Check,
  ChevronRight,
  CircleOff,
  Cpu,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  TerminalSquare,
  Unplug,
  WifiOff,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { CompanionCapabilities } from '../core/types';
import type { CompanionConnectionStatus } from '../hooks/useConversionQueue';
import { Modal } from './Modal';

export interface CompanionController {
  status: CompanionConnectionStatus;
  capabilities: CompanionCapabilities | null;
  refresh: () => Promise<CompanionCapabilities | null>;
  pair: (token: string) => Promise<CompanionCapabilities>;
  disconnect: () => Promise<void>;
}

interface CompanionPanelProps {
  companion: CompanionController;
  modalOpen: boolean;
  onOpenModal: () => void;
  onCloseModal: () => void;
}

const STATUS_COPY: Record<CompanionConnectionStatus, { label: string; detail: string }> = {
  checking: { label: 'Checking local engine', detail: 'Looking on this device…' },
  paired: { label: 'Local engine ready', detail: 'Office, audio and video enabled' },
  unpaired: { label: 'Local engine found', detail: 'Pair once to unlock Office and media' },
  unavailable: { label: 'Browser mode', detail: 'Images, PDFs and data are ready' },
};

export function CompanionStatusButton({ companion, onClick }: { companion: CompanionController; onClick: () => void }) {
  const copy = STATUS_COPY[companion.status];
  return (
    <button
      className={`companion-status companion-status--${companion.status}`}
      type="button"
      onClick={onClick}
      aria-label={`${copy.label}. ${copy.detail}`}
    >
      <span className="companion-status__signal" aria-hidden="true">
        {companion.status === 'checking' ? <LoaderCircle className="spin" size={15} /> : null}
        {companion.status === 'paired' ? <Check size={15} /> : null}
        {companion.status === 'unpaired' ? <PlugZap size={15} /> : null}
        {companion.status === 'unavailable' ? <CircleOff size={15} /> : null}
      </span>
      <span>
        <strong>{copy.label}</strong>
        <small>{copy.detail}</small>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

export function CompanionPanel({ companion, modalOpen, onOpenModal, onCloseModal }: CompanionPanelProps) {
  const copy = STATUS_COPY[companion.status];

  return (
    <>
      <aside className={`engine-card engine-card--${companion.status}`} aria-labelledby="engine-title">
        <span className="engine-card__icon" aria-hidden="true">
          {companion.status === 'paired' ? <Cpu size={22} /> : <PlugZap size={22} />}
        </span>
        <div className="engine-card__copy">
          <div className="engine-card__title-row">
            <h2 id="engine-title">{copy.label}</h2>
            {companion.status === 'paired' ? <span className="status-pill">Connected</span> : null}
          </div>
          <p>
            {companion.status === 'paired'
              ? 'Your private desktop engine handles high-fidelity documents and large media without sending them to the cloud.'
              : companion.status === 'unpaired'
                ? 'Enter the pairing code shown by Format Forge Companion to unlock document, audio and video conversion.'
                : companion.status === 'checking'
                  ? 'Checking whether Format Forge Companion is available on this device.'
                  : 'Image, PDF and data conversions work in the extension. Install the optional companion for Office and media files.'}
          </p>
        </div>
        <button className="button button--secondary engine-card__button" type="button" onClick={onOpenModal}>
          {companion.status === 'paired' ? 'Manage engine' : companion.status === 'unpaired' ? 'Pair engine' : 'Set up engine'}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </aside>

      <PairingModal companion={companion} open={modalOpen} onClose={onCloseModal} />
    </>
  );
}

function PairingModal({ companion, open, onClose }: { companion: CompanionController; open: boolean; onClose: () => void }) {
  const tokenId = useId();
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setToken('');
      setError('');
      setIsSubmitting(false);
    }
  }, [open]);

  async function handlePair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) {
      setError('Enter the pairing code shown by the companion.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await companion.pair(cleanToken);
      onClose();
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : 'That code did not work. Check it and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefresh() {
    setError('');
    await companion.refresh();
  }

  async function handleDisconnect() {
    setIsSubmitting(true);
    setError('');
    try {
      await companion.disconnect();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect the local engine.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const tools = companion.capabilities?.tools;
  const toolLabels: Record<string, string> = {
    ffmpeg: 'FFmpeg',
    ffprobe: 'FFprobe',
    libreoffice: 'LibreOffice',
    poppler: 'Poppler',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Private desktop processing"
      title={companion.status === 'paired' ? 'Local engine' : 'Connect the local engine'}
    >
      {companion.status === 'paired' ? (
        <div className="pairing-connected">
          <div className="connection-hero">
            <span><Check size={21} aria-hidden="true" /></span>
            <div>
              <strong>Connected on this device</strong>
              <p>Companion {companion.capabilities?.version ?? ''} is ready. Files stay on this device.</p>
            </div>
          </div>
          <div className="tool-grid" aria-label="Available local tools">
            {tools
              ? (Object.entries(tools) as [keyof typeof tools, (typeof tools)[keyof typeof tools]][]).map(([name, tool]) => (
                  <div className={`tool-chip${tool.available ? ' tool-chip--ready' : ''}`} key={name}>
                    {tool.available ? <Check size={14} aria-hidden="true" /> : <CircleOff size={14} aria-hidden="true" />}
                    <span>
                      <strong>{toolLabels[name] ?? name}</strong>
                      <small>{tool.available ? tool.version || 'Ready' : 'Not found'}</small>
                    </span>
                  </div>
                ))
              : null}
          </div>
          <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> Pairing credentials are stored only in Chrome’s local extension storage.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="modal-actions modal-actions--split">
            <button className="button button--danger-quiet" type="button" onClick={() => void handleDisconnect()} disabled={isSubmitting}>
              <Unplug size={16} aria-hidden="true" />
              Disconnect
            </button>
            <button className="button button--primary" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handlePair}>
          <div className="pairing-steps">
            <div className="pairing-step">
              <span>1</span>
              <div>
                <strong>Start Format Forge Companion</strong>
                <p>In the project folder, run <code>npm run dev:companion</code>.</p>
              </div>
              <TerminalSquare size={20} aria-hidden="true" />
            </div>
            <div className="pairing-step">
              <span>2</span>
              <div>
                <strong>Reveal its pairing code</strong>
                <p>In another terminal, run <code>npm run companion:token</code> and copy the result.</p>
              </div>
              <LockKeyhole size={20} aria-hidden="true" />
            </div>
          </div>
          <label className="text-field" htmlFor={tokenId}>
            <span>Pairing code</span>
            <input
              id={tokenId}
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste pairing code"
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {companion.status === 'unavailable' ? (
            <div className="offline-hint">
              <WifiOff size={17} aria-hidden="true" />
              <p><strong>Companion not detected.</strong> Start it, then check again. Browser-only conversions remain available.</p>
            </div>
          ) : null}
          <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> The extension connects only to 127.0.0.1. No internet connection is used.</p>
          <div className="modal-actions modal-actions--split">
            <button className="button button--quiet" type="button" onClick={() => void handleRefresh()} disabled={isSubmitting}>
              <RefreshCw size={15} aria-hidden="true" />
              Check again
            </button>
            <button className="button button--primary" type="submit" disabled={isSubmitting || companion.status === 'checking'}>
              {isSubmitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <PlugZap size={16} aria-hidden="true" />}
              Pair engine
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

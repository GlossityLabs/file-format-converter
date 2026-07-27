import {
  Check,
  ChevronRight,
  CircleOff,
  Cpu,
  Download,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  TerminalSquare,
  TriangleAlert,
  Unplug,
  WifiOff,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { CompanionCapabilities } from '../core/types';
import type { CompanionConnectionStatus } from '../hooks/useConversionQueue';
import { Modal } from './Modal';

export const COMPANION_DOWNLOAD_PAGE =
  'https://github.com/GlossityLabs/file-format-converter/releases/latest';

export interface CompanionController {
  status: CompanionConnectionStatus;
  capabilities: CompanionCapabilities | null;
  error: string | null;
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

const STATUS_COPY: Record<Exclude<CompanionConnectionStatus, 'paired'>, { label: string; detail: string }> = {
  checking: { label: 'Checking this Mac', detail: 'Looking for the optional Local Engine…' },
  unpaired: { label: 'Local Engine found', detail: 'Finish setup to connect it securely' },
  unavailable: { label: 'Browser-only mode', detail: 'Get the Mac app for Office, audio and video' },
};

function pairedReadiness(capabilities: CompanionCapabilities | null) {
  const officeReady = capabilities?.tools.libreoffice.available === true;
  const mediaReady = capabilities?.tools.ffmpeg.available === true;
  if (officeReady && mediaReady) {
    return {
      complete: true,
      detail: 'Office, audio and video are ready',
      description: 'The Mac app is ready to convert Office, audio and video files. Your files stay on this Mac.',
    };
  }
  if (officeReady) {
    return {
      complete: false,
      detail: 'Office is ready · Audio and video need setup',
      description: 'The Mac app is connected. Office conversions work now, but audio and video need setup in the Mac app.',
    };
  }
  if (mediaReady) {
    return {
      complete: false,
      detail: 'Audio and video are ready · Office needs setup',
      description: 'The Mac app is connected. Audio and video conversions work now, but Office conversions need setup in the Mac app.',
    };
  }
  return {
    complete: false,
    detail: capabilities ? 'Connected · Conversion tools need setup' : 'Connected · Checking conversion tools',
    description: capabilities
      ? 'The Mac app is connected, but its conversion tools are not ready. Open Format Forge for Mac and follow the setup messages.'
      : 'The Mac app is connected while Chrome checks which local conversions are ready.',
  };
}

function statusCopy(companion: CompanionController): { label: string; detail: string } {
  return companion.status === 'paired'
    ? { label: 'Local Engine connected', detail: pairedReadiness(companion.capabilities).detail }
    : STATUS_COPY[companion.status];
}

export function CompanionStatusButton({ companion, onClick }: { companion: CompanionController; onClick: () => void }) {
  const copy = statusCopy(companion);
  const readiness = pairedReadiness(companion.capabilities);
  return (
    <button
      className={`companion-status companion-status--${companion.status}`}
      type="button"
      onClick={onClick}
      aria-label={`${copy.label}. ${copy.detail}`}
    >
      <span className="companion-status__signal" aria-hidden="true">
        {companion.status === 'checking' ? <LoaderCircle className="spin" size={15} /> : null}
        {companion.status === 'paired' && readiness.complete ? <Check size={15} /> : null}
        {companion.status === 'paired' && !readiness.complete ? <TriangleAlert size={15} /> : null}
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
  const copy = statusCopy(companion);
  const readiness = pairedReadiness(companion.capabilities);

  return (
    <>
      <aside className={`engine-card engine-card--${companion.status}`} aria-labelledby="engine-title">
        <span className="engine-card__icon" aria-hidden="true">
          {companion.status === 'paired' ? <Cpu size={22} /> : <PlugZap size={22} />}
        </span>
        <div className="engine-card__copy">
          <div className="engine-card__title-row">
            <h2 id="engine-title">{copy.label}</h2>
            {companion.status === 'paired' ? (
              <span className={`status-pill${readiness.complete ? '' : ' status-pill--warning'}`}>
                {readiness.complete ? 'Ready' : 'Setup needed'}
              </span>
            ) : null}
          </div>
          <p>
            {companion.status === 'paired'
              ? readiness.description
              : companion.status === 'unpaired'
                ? 'The helper is running but automatic connection is not ready. Try connecting again, or use the developer option.'
                : companion.status === 'checking'
                  ? 'Looking for the optional helper program on this Mac. Images, PDFs, CSV and JSON work without it.'
                  : 'Install the Format Forge app once to add Office, audio and video conversion. No Terminal or account is required.'}
          </p>
        </div>
        <button className="button button--secondary engine-card__button" type="button" onClick={onOpenModal}>
          {companion.status === 'paired' ? 'Manage connection' : companion.status === 'unpaired' ? 'Finish setup' : 'Get the Mac app'}
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

  useEffect(() => {
    if (open && companion.error) setError(companion.error);
  }, [companion.error, open]);

  async function handlePair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanToken = token.trim();
    if (!cleanToken) {
      setError('Paste the private code shown by the Local Engine.');
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
    setIsSubmitting(true);
    try {
      const capabilities = await companion.refresh();
      if (capabilities?.paired) {
        if (pairedReadiness(capabilities).complete) onClose();
        else setError('The app is connected, but some conversion tools still need setup. Check the tool list below.');
      } else if (capabilities) {
        setError('The Local Engine is running, but Chrome could not connect automatically. Use the developer option below for this preview build.');
      }
    } finally {
      setIsSubmitting(false);
    }
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
  const readiness = pairedReadiness(companion.capabilities);
  const visibleToolLabels = {
    libreoffice: 'Office documents',
    ffmpeg: 'Audio and video',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Optional macOS helper"
      title={companion.status === 'paired' ? 'Local Engine connected' : 'Connect the Local Engine'}
    >
      {companion.status === 'paired' ? (
        <div className="pairing-connected">
          <div className="connection-hero">
            <span><Check size={21} aria-hidden="true" /></span>
            <div>
              <strong>Connected on this device</strong>
              <p>
                Format Forge app {companion.capabilities?.version ?? ''} is connected.{' '}
                {readiness.complete ? 'Local conversion tools are ready.' : 'Some conversion tools still need setup.'}
                {' '}Files stay on this device.
              </p>
            </div>
          </div>
          <div className="tool-grid" aria-label="Available local tools">
            {tools
              ? (Object.entries(visibleToolLabels) as [keyof typeof visibleToolLabels, string][]).map(([name, label]) => {
                  const tool = tools[name];
                  return (
                    <div className={`tool-chip${tool.available ? ' tool-chip--ready' : ''}`} key={name}>
                      {tool.available ? <Check size={14} aria-hidden="true" /> : <CircleOff size={14} aria-hidden="true" />}
                      <span>
                        <strong>{label}</strong>
                        <small>{tool.available ? tool.version || 'Ready' : 'Not found'}</small>
                      </span>
                    </div>
                  );
                })
              : null}
          </div>
          <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> Chrome connected to the Mac app automatically. Its private credential is stored only in this extension.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="modal-actions modal-actions--split">
            <button className="button button--danger-quiet" type="button" onClick={() => void handleDisconnect()} disabled={isSubmitting}>
              <Unplug size={16} aria-hidden="true" />
              Disconnect
            </button>
            <button className="button button--secondary" type="button" onClick={() => void handleRefresh()} disabled={isSubmitting}>
              {isSubmitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              Check tools again
            </button>
            <button className="button button--primary" type="button" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handlePair}>
          <div className="connection-hero local-engine-explainer">
            <span><Cpu size={21} aria-hidden="true" /></span>
            <div>
              <strong>What is the Local Engine?</strong>
              <p>
                It is the Format Forge app running privately on your Mac. Chrome handles images, PDFs, CSV and JSON itself;
                the Mac app adds Office, audio and video conversions that Chrome cannot perform alone.
              </p>
            </div>
          </div>
          <div className="modal-note pairing-definition">
            <LockKeyhole size={15} aria-hidden="true" />
            <p>
              <strong>Connection is automatic</strong>
              Install and open the app once. Chrome will recognize it and connect securely—there is no account,
              code to copy or Terminal window to keep open. Files are not uploaded to Glossity Labs.
            </p>
          </div>
          <div className="pairing-steps">
            <div className="pairing-step">
              <span>1</span>
              <div>
                <strong>Install Format Forge for Mac</strong>
                <p>Download the macOS app from the latest Format Forge release and move it to Applications.</p>
              </div>
              <Download size={20} aria-hidden="true" />
            </div>
            <div className="pairing-step">
              <span>2</span>
              <div>
                <strong>Open the app once</strong>
                <p>The app registers itself with Chrome and starts the private converter on this Mac.</p>
              </div>
              <Cpu size={20} aria-hidden="true" />
            </div>
            <div className="pairing-step">
              <span>3</span>
              <div>
                <strong>Return here and connect</strong>
                <p>Chrome starts the app when it is needed and completes the secure connection automatically.</p>
              </div>
              <PlugZap size={20} aria-hidden="true" />
            </div>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {companion.status === 'unavailable' ? (
            <div className="offline-hint">
              <WifiOff size={17} aria-hidden="true" />
              <p><strong>The Mac app is not connected yet.</strong> Browser conversions still work while you install it.</p>
            </div>
          ) : null}
          <p className="modal-note"><LockKeyhole size={15} aria-hidden="true" /> 127.0.0.1 means “this computer.” Files sent to the Local Engine stay on this Mac instead of going to a cloud conversion service.</p>
          <div className="modal-actions modal-actions--split">
            <a className="button button--secondary" href={COMPANION_DOWNLOAD_PAGE} target="_blank" rel="noopener noreferrer">
              <Download size={16} aria-hidden="true" />
              Get the Mac app
            </a>
            <button className="button button--primary" type="button" onClick={() => void handleRefresh()} disabled={isSubmitting || companion.status === 'checking'}>
              {isSubmitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {isSubmitting ? 'Connecting…' : 'Connect the app'}
            </button>
          </div>
          <details className="developer-pairing">
            <summary>Developer preview: connect without the Mac app</summary>
            <p className="developer-pairing__intro">This fallback is for people running the source code. Regular users do not need Terminal.</p>
            <div className="pairing-steps">
              <div className="pairing-step">
                <span>1</span>
                <div>
                  <strong>Start the source companion</strong>
                  <p>In the project folder, run <code>npm run dev:companion</code>.</p>
                </div>
                <TerminalSquare size={20} aria-hidden="true" />
              </div>
              <div className="pairing-step">
                <span>2</span>
                <div>
                  <strong>Reveal its private code</strong>
                  <p>In a second Terminal window, run <code>npm run companion:token</code>.</p>
                </div>
                <LockKeyhole size={20} aria-hidden="true" />
              </div>
            </div>
            <label className="text-field" htmlFor={tokenId}>
              <span>Paste the developer connection code</span>
              <input
                id={tokenId}
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste private connection code"
                autoComplete="off"
                spellCheck={false}
                disabled={isSubmitting}
              />
            </label>
            <div className="modal-actions">
              <button className="button button--quiet" type="submit" disabled={isSubmitting}>
                <PlugZap size={16} aria-hidden="true" />
                Use developer code
              </button>
            </div>
          </details>
        </form>
      )}
    </Modal>
  );
}

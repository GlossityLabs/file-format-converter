import { FilePlus2, FolderOpen, LockKeyhole, Sparkles } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.pdf',
  '.csv',
  '.json',
  '.txt',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.xls',
  '.xlsx',
  '.ods',
  '.ppt',
  '.pptx',
  '.odp',
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
].join(',');

export function DropZone({ onFiles, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  function addFileList(fileList: FileList | null) {
    if (disabled || !fileList?.length) return;
    onFiles(Array.from(fileList));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    addFileList(event.target.files);
    event.target.value = '';
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current += 1;
    if (!disabled) setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    addFileList(event.dataTransfer.files);
  }

  return (
    <section className="drop-section" aria-labelledby="drop-title">
      <div
        className={`drop-zone${isDragging ? ' drop-zone--active' : ''}${disabled ? ' drop-zone--disabled' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          onChange={handleChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="drop-art" aria-hidden="true">
          <span className="drop-art__orbit drop-art__orbit--one" />
          <span className="drop-art__orbit drop-art__orbit--two" />
          <span className="drop-art__tile">
            <FilePlus2 size={29} strokeWidth={1.7} />
          </span>
          <span className="drop-art__spark">
            <Sparkles size={15} />
          </span>
        </div>
        <div className="drop-copy">
          <p className="eyebrow">Start a conversion</p>
          <h2 id="drop-title">Drop your files here</h2>
          <p>Mix documents, images, audio and video in the same private queue.</p>
        </div>
        <button
          className="button button--primary drop-button"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <FolderOpen size={18} aria-hidden="true" />
          Choose files
        </button>
        <p className="drop-note">
          <LockKeyhole size={14} aria-hidden="true" />
          Files stay on this device · Up to 20 files / 1 GB per queue
        </p>
        {isDragging ? (
          <div className="drop-overlay" aria-hidden="true">
            <div>
              <FilePlus2 size={28} />
              <strong>Release to add</strong>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

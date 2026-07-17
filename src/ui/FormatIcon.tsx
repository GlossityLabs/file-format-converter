import {
  Braces,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Film,
  Music2,
  Presentation,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { FormatCategory, FormatId } from '../core/types';
import { getFormatCategory } from './formatData';

interface IconProps {
  size?: number | string;
  strokeWidth?: number | string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

const ICONS: Record<FormatCategory, ComponentType<IconProps>> = {
  image: FileImage,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  data: Braces,
  audio: Music2,
  video: Film,
  pdf: FileOutput,
};

interface FormatIconProps {
  format?: FormatId;
  category?: FormatCategory;
  size?: number;
}

export function FormatIcon({ format, category, size = 22 }: FormatIconProps) {
  const resolvedCategory = category ?? (format ? getFormatCategory(format) : 'data');
  const Icon = ICONS[resolvedCategory];

  return (
    <span className={`format-icon format-icon--${resolvedCategory}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

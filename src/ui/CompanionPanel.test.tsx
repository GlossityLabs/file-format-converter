import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANION_DOWNLOAD_FILE_NAME,
  COMPANION_DOWNLOAD_URL,
  CompanionPanel,
  type CompanionController,
} from './CompanionPanel';

const unavailableCompanion: CompanionController = {
  status: 'unavailable',
  capabilities: null,
  error: null,
  refresh: async () => null,
  pair: async () => {
    throw new Error('Pairing is not expected in this test.');
  },
  disconnect: async () => undefined,
};

afterEach(cleanup);

describe('CompanionPanel', () => {
  it('shows the Mac Local Engine purpose and a direct version-matched DMG download', () => {
    render(
      <CompanionPanel
        companion={unavailableCompanion}
        modalOpen={false}
        onOpenModal={() => undefined}
        onCloseModal={() => undefined}
      />,
    );

    expect(
      screen.getByText(
        'The Format Forge Mac app is the Local Engine for Office, audio and video conversion. Install and open it once; files stay on this Mac.',
      ),
    ).toBeInTheDocument();

    const download = screen.getByRole('link', { name: 'Download Mac Local Engine' });
    expect(download).toHaveAttribute('href', COMPANION_DOWNLOAD_URL);
    expect(download).toHaveAttribute('download', COMPANION_DOWNLOAD_FILE_NAME);
    expect(download).not.toHaveAttribute('target');
    expect(COMPANION_DOWNLOAD_URL).toMatch(
      /^https:\/\/github\.com\/GlossityLabs\/file-format-converter\/releases\/download\/v\d+\.\d+\.\d+\/format-forge-mac-\d+\.\d+\.\d+-universal\.dmg$/,
    );
  });

  it('uses the same direct download inside the setup modal', () => {
    render(
      <CompanionPanel
        companion={unavailableCompanion}
        modalOpen
        onOpenModal={() => undefined}
        onCloseModal={() => undefined}
      />,
    );

    const downloads = screen.getAllByRole('link', { name: 'Download Mac Local Engine' });
    expect(downloads).toHaveLength(2);
    for (const download of downloads) {
      expect(download).toHaveAttribute('href', COMPANION_DOWNLOAD_URL);
      expect(download).toHaveAttribute('download', COMPANION_DOWNLOAD_FILE_NAME);
    }
  });
});

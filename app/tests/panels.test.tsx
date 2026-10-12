// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { DISTRICTS } from '../src/content/districts';
import { Inspector } from '../src/app/Inspector';
import { BuilderPanel } from '../src/app/panels/Builder';
import { DiscoveriesPanel } from '../src/app/panels/Discoveries';
import { HelpPanel } from '../src/app/panels/Help';
import { ProjectsPanel } from '../src/app/panels/Projects';

afterEach(cleanup);

const byName = (name: string) => DISTRICTS.find(d => d.name === name)!;
const rows = () => screen.getAllByRole('button').filter(b => b.classList.contains('district-row'));

describe('the panel shell', () => {
  test('is a labelled dialog with an eyebrow, a title and a close button', () => {
    const onClose = vi.fn();
    render(<HelpPanel sector="overview" pixelated={false} fly={false} actions={{} as never} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Make yourself at home.' });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(within(dialog).getByText('A FEW WAYS TO EXPLORE')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape (cancel) and a click on the backdrop close it', () => {
    const onClose = vi.fn();
    render(<HelpPanel sector="overview" pixelated={false} fly={false} actions={{} as never} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
    // A click inside the content is not a backdrop click.
    fireEvent.click(screen.getByText('A FEW WAYS TO EXPLORE'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Projects', () => {
  test('lists all 16 addresses by default, numbered, with type badges', () => {
    render(<ProjectsPanel onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('16 ADDRESSES · ONE CONNECTED WORLD')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Explore the projects.' })).toBeTruthy();
    expect(screen.getByText('Every building has a purpose. Choose an address to get closer.')).toBeTruthy();
    const all = rows();
    expect(all).toHaveLength(16);
    expect(all[0].textContent).toContain('01');
    expect(all[0].textContent).toContain('Admissions Platform');
    expect(all[0].textContent).toContain('11,000 users');
    expect(within(all[0]).getByText('LIVE').classList.contains('live')).toBe(true);
    expect(all[8].textContent).toContain('KIRA AI / Speech Lab');
    expect(within(all[8]).getByText('LAB')).toBeTruthy();
    // Public repositories repeat their name and show their language, or CODE.
    expect(within(all[12]).getByText('C++')).toBeTruthy();
    expect(within(all[15]).getByText('CODE')).toBeTruthy();
    expect(
      screen.getByText('Public repository snapshot · 04 Sept 2026. Production impact supplied by the builder.'),
    ).toBeTruthy();
  });

  test('filters renumber from 01; KIRA AI is neither production nor public', () => {
    render(<ProjectsPanel onSelect={() => {}} onClose={() => {}} />);
    const tab = (name: string) => screen.getByRole('button', { name });
    expect(tab('all').classList.contains('active')).toBe(true);
    fireEvent.click(tab('production'));
    expect(tab('production').classList.contains('active')).toBe(true);
    expect(rows()).toHaveLength(9);
    expect(rows().some(r => r.textContent!.includes('KIRA AI'))).toBe(false);
    fireEvent.click(tab('public repositories'));
    expect(rows().map(r => r.querySelector('strong')!.textContent)).toEqual([
      'PodBus',
      'cinder',
      'tensora',
      'veyra',
      'Pixen',
      'eukalpia',
    ]);
    expect(rows()[0].textContent).toContain('01');
  });

  test('choosing a row selects that district', () => {
    const onSelect = vi.fn();
    render(<ProjectsPanel onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(rows()[1]);
    expect(onSelect).toHaveBeenCalledWith(byName('lms.turin.uz').id);
  });
});

describe('the district inspector', () => {
  test('a production platform: eyebrow, impact, address and the platform link', () => {
    render(<Inspector district={byName('lms.turin.uz')} onClose={() => {}} />);
    const card = screen.getByRole('complementary', { name: 'University LMS' });
    expect(within(card).getByText('● IN PRODUCTION')).toBeTruthy();
    expect(within(card).getByText('Serving the entire university')).toBeTruthy();
    expect(within(card).getByText('lms.turin.uz')).toBeTruthy();
    const link = within(card).getByRole('link', { name: /VISIT PLATFORM/ });
    expect(link.getAttribute('href')).toBe('https://lms.turin.uz');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  test('a public repository shows its language and stars, singular for one', () => {
    const tensora = byName('tensora');
    render(<Inspector district={tensora} onClose={() => {}} />);
    expect(screen.getByText('PUBLIC REPOSITORY')).toBeTruthy();
    expect(
      screen.getByText(
        `${tensora.language ?? 'Experimental'} · ${tensora.stars} ${tensora.stars === 1 ? 'star' : 'stars'}`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /OPEN REPOSITORY/ })).toBeTruthy();
  });

  test('the lab and its capabilities; closing only asks to clear the selection', () => {
    const onClose = vi.fn();
    render(<Inspector district={byName('KIRA AI')} onClose={onClose} />);
    expect(screen.getByText('SPEECH INTELLIGENCE LAB')).toBeTruthy();
    expect(screen.getByRole('link', { name: /READ THE UNIVERSITY FEATURE/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close district details' }));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    const cau = byName('EDU AI / CAU');
    render(<Inspector district={cau} onClose={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(cau.capabilities!.length);
  });

  test('takes focus when it opens', () => {
    render(<Inspector district={byName('lms.turin.uz')} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('complementary'));
  });
});

describe('Discoveries', () => {
  test('before anything is found: six unknown signals with their hints', () => {
    render(<DiscoveriesPanel found={[]} onClose={() => {}} />);
    expect(screen.getByText('0 OF 6 DISCOVERIES')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Look a little closer.' })).toBeTruthy();
    expect(
      screen.getByText(
        'Six small secrets live in this world. No leaderboard. No rush. Your discoveries stay on this device.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Unknown signal')).toHaveLength(6);
    expect(screen.getByText('Someone with whiskers lives near Admissions. Look closely at the rooftops.')).toBeTruthy();
  });

  test('found signals show their name and message, in the fixed order', () => {
    render(<DiscoveriesPanel found={['ghost', 'cat']} onClose={() => {}} />);
    expect(screen.getByText('2 OF 6 DISCOVERIES')).toBeTruthy();
    expect(screen.getByText('Rooftop resident')).toBeTruthy();
    expect(screen.getByText('ROOFTOP RESIDENT · The city has adopted you.')).toBeTruthy();
    const names = Array.from(document.querySelectorAll('.signal strong')).map(s => s.textContent);
    expect(names).toEqual([
      'Rooftop resident',
      'Unknown signal',
      'Unknown signal',
      'Unknown signal',
      'Unknown signal',
      'After hours',
    ]);
  });

  test('all six: the city remembers you; Back to exploring closes', () => {
    const onClose = vi.fn();
    render(
      <DiscoveriesPanel found={['cat', 'monolith', 'override', 'underworld', 'cipher', 'ghost']} onClose={onClose} />,
    );
    expect(screen.getByRole('dialog', { name: 'The city remembers you.' })).toBeTruthy();
    expect(
      screen.getByText('You looked a little closer. You stayed a little longer. This world is better with you in it.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back to exploring/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('the builder', () => {
  test('heading, bio, contacts and the six facts with their links', () => {
    render(<BuilderPanel onMaintenance={() => {}} onClose={() => {}} />);
    expect(screen.getByText('THE PERSON BEHIND THIS WORLD')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'The builder.' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe("Umaraliev RavshanRustamjon O'gli");
    expect(screen.getByText('AI Engineer · Coordinator · Systems Builder')).toBeTruthy();
    const telegram = screen.getByRole('link', { name: /Let's talk on Telegram/ });
    expect(telegram.getAttribute('href')).toBe('https://t.me/umaraliev_ravshan');
    expect(telegram.getAttribute('target')).toBe('_blank');
    const phone = screen.getByRole('link', { name: /\+998 33 885 55 75/ });
    expect(phone.getAttribute('href')).toBe('tel:+998338855575');
    expect(phone.hasAttribute('target')).toBe(false);
    for (const label of ['EDU AI / CAU', 'ENGINEERING', 'SPEECH AI', 'COLLABORATION', 'ON STAGE', 'FOUNDATIONS'])
      expect(screen.getByText(label, { selector: '.author-facts span' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Read the university feature/ }).getAttribute('href')).toBe(
      'https://t.me/polito_uz/5958',
    );
    expect(screen.getByRole('link', { name: 'EDUWIFI' }).getAttribute('href')).toBe('https://eduwifi.uz');
    expect(screen.getByRole('link', { name: /FOLLOW THE WORK/ }).getAttribute('href')).toBe(
      'https://github.com/eukalpia',
    );
  });

  test('the hidden door to floor −1', () => {
    const onMaintenance = vi.fn();
    render(<BuilderPanel onMaintenance={onMaintenance} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /MAINTENANCE \/ FLOOR −1/ }));
    expect(onMaintenance).toHaveBeenCalled();
  });
});

describe('Help', () => {
  const actions = () => ({ tour: vi.fn(), street: vi.fn(), pixel: vi.fn(), fly: vi.fn() });

  test('six rows; the keyboard row reads as one sentence (v1 split it into columns)', () => {
    render(<HelpPanel sector="overview" pixelated={false} fly={false} actions={actions()} onClose={() => {}} />);
    const rows = document.querySelectorAll('.help-list p');
    expect(rows).toHaveLength(6);
    expect(rows[1].textContent).toBe(
      'Projects opens every district with keyboard or touch. Press D for the directory and E to switch between orbit and street level.',
    );
    expect(rows[1].querySelectorAll('kbd')).toHaveLength(2);
    // The text sits in one element, not in loose flex items around the kbds.
    expect(rows[1].querySelector('span')!.textContent).toBe(rows[1].textContent);
  });

  test('actions name what they will do and fire', () => {
    const a = actions();
    render(<HelpPanel sector="overview" pixelated={false} fly={false} actions={a} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Start cinematic tour/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explore street level/ }));
    const pixel = screen.getByRole('button', { name: /Pixel vision/ });
    expect(pixel.getAttribute('aria-pressed')).toBe('false');
    expect(pixel.textContent).toContain('OFF');
    fireEvent.click(pixel);
    fireEvent.click(screen.getByRole('button', { name: /Enable free flight \(keyboard\)/ }));
    expect([a.tour, a.street, a.pixel, a.fly].map(f => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
    cleanup();
    render(<HelpPanel sector="street" pixelated fly actions={actions()} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Return to orbit/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pixel vision/ }).textContent).toContain('ON');
    expect(screen.getByRole('button', { name: /Exit free flight/ })).toBeTruthy();
  });
});

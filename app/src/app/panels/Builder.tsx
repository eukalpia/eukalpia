import { ArrowDown, ArrowUpRight, GitFork, Phone, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { BUILDER } from '../../content/builder';
import { Panel } from './Panel';

const out = { target: '_blank', rel: 'noreferrer' } as const;

function Fact({ label, children, links = [] }: { label: string; children: ReactNode; links?: [string, string][] }) {
  return (
    <div>
      <span>{label}</span>
      <p>{children}</p>
      {links.map(([text, url]) => (
        <a key={url} href={url} {...out}>
          {text}
          <ArrowUpRight size={12} />
        </a>
      ))}
    </div>
  );
}

/** v1's author panel, copy verbatim (inventory 2.6), name as the spec spells it. */
export function BuilderPanel({ onMaintenance, onClose }: { onMaintenance(): void; onClose(): void }) {
  const [first, last] = [
    BUILDER.fullName.split(' ').slice(0, 2).join(' '),
    BUILDER.fullName.split(' ').slice(2).join(' '),
  ];
  return (
    <Panel className="author-panel" eyebrow="THE PERSON BEHIND THIS WORLD" title="The builder." onClose={onClose}>
      <div className="builder-heading">
        <div className="builder-mark">
          RU<span>↗</span>
        </div>
        <div>
          <h3>
            {first}
            <br />
            {last}
          </h3>
          <p>AI Engineer · Coordinator · Systems Builder</p>
        </div>
      </div>
      <p className="builder-bio">
        Graduate of <strong>Turin Polytechnic University in Tashkent</strong>. I build production systems for
        universities and businesses, and AI solutions that solve real operational problems.
      </p>
      <div className="contact-links">
        <a href="https://t.me/umaraliev_ravshan" {...out}>
          <Send size={14} />
          Let's talk on Telegram
          <ArrowUpRight size={12} />
        </a>
        <a href="tel:+998338855575">
          <Phone size={14} />
          +998 33 885 55 75
        </a>
      </div>
      <div className="author-facts">
        <Fact label="EDU AI / CAU">
          <strong>Fully integrated into CAU University's LMS.</strong> Turns course topics, documents, presentations and
          recorded lectures into ready-to-use assessments. Supports four question formats, checks answers automatically,
          calculates scores and explains correct answers. Teachers can prepare assessments from their own materials;
          students can complete them and receive feedback within the university's existing learning workflow. Supports
          English and Russian.
        </Fact>
        <Fact label="ENGINEERING">
          AI solutions deployed in business workflows, including <strong>CAU University</strong>. Additional client work
          is covered by non-disclosure agreements.
        </Fact>
        <Fact label="SPEECH AI" links={[['Read the university feature', 'https://t.me/polito_uz/5958']]}>
          <strong>KIRA AI</strong> — Uzbek speech intelligence. Developed speech-to-text featured by TTPU, with support
          for Uzbek, English and Russian. Independently developed text-to-speech as well; the TTS work remains
          unreleased.
        </Fact>
        <Fact
          label="COLLABORATION"
          links={[["The university's collaboration report", 'https://t.me/s/polito_uz?before=7732']]}
        >
          <strong>MIMAX Software Group × AJIN Industrial</strong>
          <br />
          AI engineering and cross-border collaboration. The university describes the team's work on production and
          warehouse monitoring and AI-assisted production forecasting, in cooperation with Gyeongbuk Technopark.
        </Fact>
        <Fact
          label="ON STAGE"
          links={[
            ['ICT WEEK speaker directory', 'https://ictweek.uz/eng/speaker/index?page=5'],
            [
              'Read the IT Park / Outsource report',
              'https://outsource.gov.uz/en/media/uzbekkorean-bpo-forum-in-tashkent-new-opportunities-for-outsourcing-and-partnership',
            ],
          ]}
        >
          <strong>ICT WEEK Uzbekistan · Uzbekistan–Korea BPO Forum</strong>
          <br />
          Listed as AI Engineer Coordinator at MIMAX Software Group. On September 25, 2025, presented the team's
          collaboration journey with AJIN at the BPO forum.
        </Fact>
        <Fact label="FOUNDATIONS">
          Original developer of{' '}
          <a href="https://eduwifi.uz" {...out}>
            EDUWIFI
          </a>
          . Built admissions, learning, access-control, telephony, inventory, AR and creative platforms. SKUD and PBX
          systems serve multiple organizations.
        </Fact>
      </div>
      <a className="visit-button" href="https://github.com/eukalpia" {...out}>
        FOLLOW THE WORK
        <GitFork size={17} />
      </a>
      <button className="world-maintenance" onClick={onMaintenance}>
        MAINTENANCE / FLOOR −1
        <ArrowDown size={11} />
      </button>
    </Panel>
  );
}

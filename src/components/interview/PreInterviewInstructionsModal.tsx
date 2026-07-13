'use client';

const INSTRUCTIONS = [
  'Say "let me think" or "one sec" if you need a moment. Sage will wait.',
  'Speak in complete thoughts. Sage may jump in if you pause mid-sentence.',
  "Sage will push back on vague answers. That's the point.",
  'Use a quiet room and a decent mic. Background noise degrades the transcript.',
  'Sage will end the interview once every area has been covered.',
];

export function PreInterviewInstructionsModal({ onReady }: { onReady: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-md flex flex-col gap-8 animate-fade-in">
        <h2
          className="text-3xl text-center"
          style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
        >
          Before we begin
        </h2>

        <ul className="flex flex-col gap-4">
          {INSTRUCTIONS.map((item, i) => (
            <li
              key={i}
              className="text-sm text-[var(--text-secondary)] leading-relaxed pl-4"
              style={{ borderLeft: '2px solid var(--border-bright)' }}
            >
              {item}
            </li>
          ))}
        </ul>

        <button
          onClick={onReady}
          className="w-full py-5 rounded-xl text-sm tracking-widest uppercase font-medium transition-opacity active:opacity-80"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          I'm ready
        </button>
      </div>
    </div>
  );
}

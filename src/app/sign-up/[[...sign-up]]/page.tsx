import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        fontFamily: 'DM Mono, monospace',
      }}
    >
      {/* ── LEFT COLUMN (desktop only) ── */}
      <div
        className="hidden lg:flex"
        style={{
          width: '60%',
          background: '#0a0a0a',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '2.5rem 3.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Violet radial glow */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '680px',
            height: '680px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Logo */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <span
            style={{
              fontFamily: 'DM Serif Display, serif',
              fontSize: '1.75rem',
              color: '#c8b89a',
              letterSpacing: '-0.01em',
            }}
          >
            Sage
          </span>
        </div>

        {/* Headline block */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <h1
            style={{
              fontFamily: 'DM Serif Display, serif',
              fontSize: 'clamp(2.4rem, 4vw, 3.4rem)',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              color: '#f0ebe3',
              margin: 0,
            }}
          >
            Practice like
            <br />
            <span style={{ color: '#c8b89a' }}>it's real.</span>
          </h1>
          <p
            style={{
              fontSize: '0.85rem',
              lineHeight: 1.65,
              color: '#6b6863',
              margin: 0,
              maxWidth: '26rem',
            }}
          >
            One session is enough to know exactly where you stand.
            Adaptive questions, real follow-ups, scored results.
          </p>
        </div>

        {/* Footer text */}
        <p
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: '0.7rem',
            color: '#3d3b37',
            letterSpacing: '0.03em',
            margin: 0,
          }}
        >
          Trusted by job seekers preparing for top companies
        </p>
      </div>

      {/* ── RIGHT COLUMN (full width on mobile) ── */}
      <div
        style={{
          flex: 1,
          background: '#141414',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem',
          gap: '2rem',
        }}
      >
        {/* Mobile-only wordmark */}
        <span
          className="lg:hidden"
          style={{
            fontFamily: 'DM Serif Display, serif',
            fontSize: '1.75rem',
            color: '#c8b89a',
          }}
        >
          Sage
        </span>

        <SignUp
          appearance={{
            variables: {
              colorBackground: '#141414',
              colorInputBackground: '#1a1a1a',
              colorInputText: '#f0ebe3',
              colorText: '#f0ebe3',
              colorTextSecondary: '#9a9a9a',
              colorPrimary: '#c8b89a',
              colorNeutral: '#c8b89a',
              borderRadius: '8px',
              fontFamily: 'DM Mono, monospace',
            },
          }}
        />
      </div>
    </div>
  );
}

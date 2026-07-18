'use client';

import { useState, useRef, useEffect, memo } from 'react';

// ─────────────────────────────────────────────
// INTERVIEW FORM — owns its own local state so
// keystrokes never propagate up to Home
// ─────────────────────────────────────────────
export const InterviewForm = memo(function InterviewForm({
  isVisible,
  onStart,
  onClose,
  unlockAudio,
  isSupported,
  error,
}: {
  isVisible: boolean;
  onStart: (data: { resumePdfBase64: string; jobDescription: string; roundType: 'screening' | 'technical' | 'final' }) => void;
  onClose: () => void;
  unlockAudio: () => void;
  isSupported: boolean;
  error: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jdRef = useRef('');

  const [resumeBase64, setResumeBase64] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [jdHasValue, setJdHasValue] = useState(false);
  const [roundType, setRoundType] = useState<'screening' | 'technical' | 'final'>('screening');
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setResumeBase64('');
      setResumeFileName('');
      setFileError('');
      jdRef.current = '';
      setJdHasValue(false);
      setRoundType('screening');
      setIsDragging(false);
    }
  }, [isVisible]);

  // Shared by the hidden <input type="file"> onChange and drag-and-drop onDrop
  // so file validation/reading logic lives in exactly one place.
  const processFile = (file: File | null | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setFileError('Please upload a PDF file.');
      return;
    }
    setFileError('');
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setResumeBase64(base64);
      setResumeFileName(file.name);
    };
    reader.onerror = () => {
      setFileError('Could not read that file. Try again.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleRemoveFile = () => {
    setResumeBase64('');
    setResumeFileName('');
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleJdChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    jdRef.current = e.target.value;
    const next = e.target.value.trim().length > 0;
    setJdHasValue(prev => prev === next ? prev : next);
  };

  const canSubmit = resumeBase64.length > 0 && jdHasValue;

  const handleSubmit = () => {
    if (!canSubmit) return;
    unlockAudio();
    onStart({ resumePdfBase64: resumeBase64, jobDescription: jdRef.current.trim(), roundType });
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    processFile(e.dataTransfer.files?.[0]);
    setIsDragging(false);
  };

  return (
    // Always in the DOM — visibility toggled via CSS so there's no mount cost on click
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        transition: 'opacity 0.15s ease',
      }}
    >
      {/* Backdrop — solid, no blur (blur is very GPU-expensive on large elements) */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full sm:max-w-md border border-[var(--border-bright)] rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 z-10 flex flex-col gap-5"
        style={{
          background: 'var(--surface)',
          transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'transform 0.15s ease',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-base text-[var(--text-primary)]"
              style={{ fontFamily: 'DM Serif Display, serif' }}>
              Start your session
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Configure your interview below</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Resume upload */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Resume (PDF)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          {resumeBase64 ? (
            <div
              className="flex items-center justify-between border rounded-lg px-4 py-3"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">{resumeFileName}</span>
              <button
                onClick={handleRemoveFile}
                className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm leading-none flex-shrink-0">
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border rounded-lg px-4 py-6 text-sm text-[var(--text-muted)] transition-colors duration-100 text-center"
              style={{
                background: 'var(--bg)',
                borderColor: isDragging ? 'var(--accent)' : 'var(--border)',
                borderStyle: 'dashed',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              Click to upload your resume PDF
            </button>
          )}
          {fileError && <p className="text-xs text-[var(--red)]">{fileError}</p>}
        </div>

        {/* Job description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Job description
          </label>
          <textarea
            onChange={handleJdChange}
            placeholder="Paste the job description here..."
            rows={5}
            className="w-full border rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Round type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Interview round
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['screening', 'technical', 'final'] as const).map((round) => (
              <button key={round}
                onClick={() => setRoundType(round)}
                className="py-2 rounded-lg text-xs tracking-widest uppercase transition-colors duration-100 border"
                style={{
                  borderColor: roundType === round ? 'var(--accent)' : 'var(--border)',
                  color: roundType === round ? 'var(--accent)' : 'var(--text-muted)',
                  background: roundType === round ? 'var(--glow)' : 'transparent',
                }}>
                {round}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[var(--red)]">{error}</p>}

        {!isSupported && (
          <p className="text-xs text-[var(--red)]">
            Voice input is not available. Your browser may be too old, or try accessing the app over HTTPS.
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 rounded-lg text-sm tracking-widest uppercase transition-colors duration-100"
          style={{
            background: canSubmit ? 'var(--accent)' : 'var(--surface)',
            color: canSubmit ? 'var(--bg)' : 'var(--text-muted)',
            opacity: canSubmit ? '1' : '0.3',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}>
          Begin Interview
        </button>
      </div>
    </div>
  );
});

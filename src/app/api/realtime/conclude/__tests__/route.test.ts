import { NextRequest } from 'next/server';
import * as extractJsonLib from '@/lib/extractJson';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

jest.mock('@/lib/supabase', () => ({
  createAdminClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null }),
      insert: jest.fn().mockReturnThis(),
    })),
  })),
}));

import { POST } from '../route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/realtime/conclude', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const baseBody = {
  exchanges: [
    { areaId: '1', question: 'What is React?', answer: 'A UI library.', quality: 'medium' },
  ],
  topicAreas: [{ id: '1', name: 'React Basics' }],
  role: 'Frontend Engineer',
  experienceLevel: 'mid-level',
  interviewType: 'technical',
};

describe('POST /api/realtime/conclude', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when exchanges array is empty', async () => {
    const res = await POST(makeRequest({ ...baseBody, exchanges: [] }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/no exchanges/i);
  });

  it('returns 500 when the Anthropic client throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API unavailable'));

    const res = await POST(makeRequest(baseBody));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });

  it('calls extractJson with the model response text', async () => {
    const responseText = JSON.stringify({
      summary: 'Good overall.',
      areaScores: [],
      strengths: [],
      weakMoments: [],
      areasForImprovement: [],
      overallScore: 7,
      readinessRating: '70% ready for this role',
      recommendation: 'Practice more.',
    });

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: responseText }],
    });

    const spy = jest.spyOn(extractJsonLib, 'extractJson');

    await POST(makeRequest(baseBody));

    expect(spy).toHaveBeenCalledWith(responseText);
  });

  it('returns success with the expected finalEvaluation shape', async () => {
    const mockEval = {
      summary: 'Solid performance.',
      areaScores: [{ areaName: 'React Basics', score: 7, feedback: 'Clear answers.' }],
      strengths: ['Articulated tradeoffs well'],
      weakMoments: [],
      areasForImprovement: ['Deeper hooks knowledge'],
      overallScore: 7,
      readinessRating: '70% ready for this role',
      recommendation: 'Study hooks internals.',
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(mockEval) }],
    });

    const res = await POST(makeRequest(baseBody));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const fe = data.finalEvaluation;
    expect(typeof fe.summary).toBe('string');
    expect(typeof fe.overallScore).toBe('number');
    expect(typeof fe.readinessRating).toBe('string');
    expect(typeof fe.recommendation).toBe('string');
    expect(Array.isArray(fe.strengths)).toBe(true);
    expect(Array.isArray(fe.areasForImprovement)).toBe(true);
  });
});

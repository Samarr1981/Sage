import { NextRequest } from 'next/server';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { POST } from '../route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/realtime/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const validBody = {
  resumePdfBase64: 'JVBERi0xLjQ=',
  jobDescription: 'Senior Software Engineer at Acme Corp. Requires 5+ years of TypeScript.',
  roundType: 'technical',
};

describe('POST /api/realtime/initialize', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when resumePdfBase64 is missing', async () => {
    const res = await POST(makeRequest({ jobDescription: validBody.jobDescription, roundType: 'technical' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/resumePdfBase64/i);
  });

  it('returns 400 when jobDescription is missing', async () => {
    const res = await POST(makeRequest({ resumePdfBase64: validBody.resumePdfBase64, roundType: 'technical' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/jobDescription/i);
  });

  it('returns 400 when roundType is invalid', async () => {
    const res = await POST(makeRequest({ ...validBody, roundType: 'behavioral' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/roundType/i);
  });

  it('returns success with a topicAreas array of length 3 for a valid request', async () => {
    const mockPlan = {
      role: 'Software Engineer',
      company: 'Acme',
      seniority: 'mid-level',
      roundType: 'technical',
      areas: [
        { name: 'System Design', whyRelevant: 'Core skill', skillsToTest: [], strongAnswerLooksLike: 'Detailed' },
        { name: 'Algorithms',    whyRelevant: 'Core skill', skillsToTest: [], strongAnswerLooksLike: 'Correct' },
        { name: 'TypeScript',    whyRelevant: 'JD req',     skillsToTest: [], strongAnswerLooksLike: 'Fluent' },
      ],
      gapsToProbe: [],
      strengthsToConfirm: [],
    };

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(mockPlan) }],
    });

    const res = await POST(makeRequest(validBody));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.topicAreas)).toBe(true);
    expect(data.topicAreas).toHaveLength(3);
    expect(data.topicAreas[0]).toMatchObject({ id: '1', name: 'System Design', covered: false });
  });
});

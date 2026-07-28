import { createEventSchema, createGroupSchema, loginSchema, passwordSchema, signupSchema } from './schemas';

describe('passwordSchema', () => {
  it.each(['Passw0rdOk', 'Sup3rSecret', 'Aa1aaaaa'])('accepts strong password %s', (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(true);
  });

  it.each([
    ['short', 'Aa1'],
    ['no uppercase', 'password1'],
    ['no lowercase', 'PASSWORD1'],
    ['no digit', 'PasswordX'],
  ])('rejects %s', (_label, pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
});

describe('signupSchema', () => {
  const valid = { name: 'Ada', phone: '+14145550100', password: 'Passw0rdOk' };

  it('accepts a valid signup', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid phones', () => {
    expect(signupSchema.safeParse({ ...valid, phone: '123' }).success).toBe(false);
  });

  it('rejects an empty name after trimming', () => {
    expect(signupSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires a non-empty password but no complexity', () => {
    expect(loginSchema.safeParse({ identifier: '4145550100', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: '4145550100', password: '' }).success).toBe(false);
  });
});

describe('createGroupSchema', () => {
  const valid = {
    name: 'Hiking Club',
    description: 'We hike together every weekend.',
    category: 'OUTDOORS',
    privacy: 'PUBLIC' as const,
  };

  it('accepts a valid group', () => {
    expect(createGroupSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects short descriptions', () => {
    expect(createGroupSchema.safeParse({ ...valid, description: 'short' }).success).toBe(false);
  });

  it('rejects unknown privacy values', () => {
    expect(createGroupSchema.safeParse({ ...valid, privacy: 'SECRET' }).success).toBe(false);
  });

  it('allows an empty cover image but rejects non-URLs', () => {
    expect(createGroupSchema.safeParse({ ...valid, coverImage: '' }).success).toBe(true);
    expect(createGroupSchema.safeParse({ ...valid, coverImage: 'nope' }).success).toBe(false);
  });
});

describe('createEventSchema', () => {
  const base = {
    title: 'Morning Run',
    description: 'A gentle 5k around the park.',
    mode: 'IN_PERSON' as const,
    locationName: 'Golden Gate Park',
    startTime: '2030-05-01T09:00',
    endTime: '2030-05-01T10:00',
  };

  it('accepts a valid in-person event', () => {
    expect(createEventSchema.safeParse(base).success).toBe(true);
  });

  it('rejects events ending before they start', () => {
    const result = createEventSchema.safeParse({
      ...base,
      endTime: '2030-05-01T08:00',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('endTime'))).toBe(true);
    }
  });

  it('requires a meeting link for online events', () => {
    const result = createEventSchema.safeParse({ ...base, mode: 'ONLINE', onlineUrl: '' });
    expect(result.success).toBe(false);
  });

  it('requires a location for hybrid events', () => {
    const result = createEventSchema.safeParse({
      ...base,
      mode: 'HYBRID',
      locationName: '',
      onlineUrl: 'https://meet.example.com/x',
    });
    expect(result.success).toBe(false);
  });

  it('coerces capacity to a number and enforces minimum 1', () => {
    expect(createEventSchema.safeParse({ ...base, capacity: '25' }).success).toBe(true);
    expect(createEventSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
  });
});

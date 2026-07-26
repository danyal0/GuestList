import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().email('Enter a valid email'),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'At least 3 characters').max(80),
  description: z.string().trim().min(10, 'Tell people a bit more (10+ characters)').max(5000),
  category: z.string().min(1, 'Pick a category'),
  privacy: z.enum(['PUBLIC', 'PRIVATE', 'HIDDEN']),
  location: z.string().max(120).optional(),
  rules: z.string().max(10000).optional(),
  coverImage: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

export const createEventSchema = z
  .object({
    title: z.string().trim().min(3, 'At least 3 characters').max(140),
    description: z.string().trim().min(10, 'Describe the event (10+ characters)').max(10000),
    mode: z.enum(['IN_PERSON', 'ONLINE', 'HYBRID']),
    locationName: z.string().max(140).optional(),
    address: z.string().max(300).optional(),
    onlineUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
    startTime: z.string().min(1, 'Start time is required'),
    endTime: z.string().min(1, 'End time is required'),
    capacity: z.coerce.number().int().min(1).max(100000).optional(),
    recurrenceRule: z.string().max(300).optional(),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: 'End time must be after start time',
    path: ['endTime'],
  })
  .refine(
    (data) => data.mode === 'IN_PERSON' || (data.onlineUrl && data.onlineUrl.length > 0),
    { message: 'Online and hybrid events need a meeting link', path: ['onlineUrl'] },
  )
  .refine(
    (data) => data.mode === 'ONLINE' || (data.locationName && data.locationName.length > 0),
    { message: 'In-person and hybrid events need a location', path: ['locationName'] },
  );

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().max(1000).optional(),
  location: z.string().max(120).optional(),
  interests: z.array(z.string().max(40)).max(20),
  skills: z.array(z.string().max(40)).max(20),
});

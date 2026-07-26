'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { profileSchema } from '@/lib/schemas';
import type { User } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Avatar } from '@/components/ui/avatar';

function TagEditor({
  label,
  id,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = React.useState('');

  const add = () => {
    const value = input.trim().toLowerCase();
    if (value && !tags.includes(value) && tags.length < 20) {
      onChange([...tags, value]);
    }
    setInput('');
  };

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[13px] font-semibold text-[var(--color-accent)]"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="rounded-full hover:bg-black/10"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={tags.length === 0 ? placeholder : 'Add more…'}
          className="min-w-[120px] flex-1 bg-transparent px-2 py-1.5 text-[14px] outline-none placeholder:text-[var(--color-ink-tertiary)]"
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, hydrated, setUser, clear } = useAuthStore();
  const [interests, setInterests] = React.useState<string[]>([]);
  const [skills, setSkills] = React.useState<string[]>([]);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=/settings');
    if (user && !initialized.current) {
      initialized.current = true;
      setInterests(user.interests);
      setSkills(user.skills);
      setAvatarUrl(user.avatarUrl);
    }
  }, [hydrated, user, router]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<User>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (updated) => {
      setUser({ ...user!, ...updated });
      toast.success('Profile updated');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Update failed'),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api('/users/me', { method: 'DELETE' }),
    onSuccess: () => {
      clear();
      toast.success('Your account has been deleted.');
      router.push('/');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Deletion failed'),
  });

  const resendVerification = useMutation({
    mutationFn: () => api('/auth/resend-verification', { method: 'POST', body: '{}' }),
    onSuccess: () => toast.success('Verification email sent — check your inbox.'),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not send'),
  });

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const csrf = document.cookie.match(/gatherly_csrf=([^;]+)/)?.[1];
      const response = await fetch('/api/v1/uploads/image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : undefined,
      });
      if (!response.ok) throw new Error('Upload failed — JPEG, PNG, WebP or GIF up to 5MB.');
      const { url } = await response.json();
      setAvatarUrl(url);
      save.mutate({ avatarUrl: url });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setAvatarUploading(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get('name')),
      bio: String(form.get('bio') || '') || undefined,
      location: String(form.get('location') || '') || undefined,
      interests,
      skills,
    };
    const parsed = profileSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Check your inputs');
      return;
    }
    save.mutate(parsed.data);
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-xl space-y-10">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Settings</h1>
        <p className="text-[15px] text-[var(--color-ink-secondary)]">
          Your profile, the way you want it.
        </p>
      </div>

      {!user.emailVerified && (
        <div className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-4">
          <p className="text-[14px]">
            <strong>Verify your email</strong> to unlock all features.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => resendVerification.mutate()}
            loading={resendVerification.isPending}
          >
            Resend link
          </Button>
        </div>
      )}

      {/* Avatar */}
      <section className="flex items-center gap-5">
        <Avatar src={avatarUrl} name={user.name} size="xl" />
        <div>
          <label className="inline-block cursor-pointer">
            <span className="rounded-[var(--radius-md)] bg-[var(--color-surface-3)] px-4 py-2.5 text-[14px] font-semibold transition-colors hover:bg-[var(--color-accent-soft)]">
              {avatarUploading ? 'Uploading…' : 'Change photo'}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              disabled={avatarUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadAvatar(file);
              }}
            />
          </label>
          <p className="mt-2 text-[13px] text-[var(--color-ink-tertiary)]">
            JPEG, PNG, WebP or GIF. 5MB max.
          </p>
        </div>
      </section>

      {/* Profile form */}
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={user.name} required />
        </div>
        <div>
          <Label htmlFor="bio">Bio</Label>
          <Textarea id="bio" name="bio" defaultValue={user.bio ?? ''} placeholder="A line or two about you…" />
        </div>
        <div>
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" defaultValue={user.location ?? ''} placeholder="San Francisco, CA" />
        </div>
        <TagEditor
          label="Interests"
          id="interests"
          tags={interests}
          onChange={setInterests}
          placeholder="hiking, photography, machine learning…"
        />
        <TagEditor
          label="Skills"
          id="skills"
          tags={skills}
          onChange={setSkills}
          placeholder="python, public speaking, guitar…"
        />
        <Button type="submit" loading={save.isPending} size="lg">
          Save changes
        </Button>
      </form>

      {/* Danger zone */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 p-5">
        <h2 className="text-[17px] font-bold text-[var(--color-danger)]">Danger zone</h2>
        <p className="mt-1 text-[14px] text-[var(--color-ink-secondary)]">
          Deleting your account anonymizes your data and signs you out everywhere. This cannot be
          undone.
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" className="mt-4">
              Delete account
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Delete your account?"
            description="This permanently anonymizes your profile and removes your access. There is no undo."
          >
            <div className="flex gap-3">
              <Button
                variant="destructive"
                className="flex-1"
                loading={deleteAccount.isPending}
                onClick={() => deleteAccount.mutate()}
              >
                Yes, delete it
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}

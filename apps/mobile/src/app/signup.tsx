import * as React from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { api, storeSession } from '@/lib/api';
import { spacing, useTheme } from '@/lib/theme';
import type { User } from '@/lib/types';

interface LinkSuggestion {
  userId: string;
  name: string;
  clues: Array<{ eventId: string; summary: string }>;
}

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  linkSuggestions?: LinkSuggestion[];
}

export default function SignupScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [linkSuggestions, setLinkSuggestions] = React.useState<LinkSuggestion[] | null>(null);
  const [claimingId, setClaimingId] = React.useState<string | null>(null);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    const digits = phone.replace(/\D/g, '');
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (digits.length < 7 || digits.length > 15) next.phone = 'Enter a valid phone number.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    else if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password))
      next.password = 'Include upper and lower case letters and a number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const finish = () => {
    router.dismissAll();
  };

  const claim = async (suggestion: LinkSuggestion) => {
    setClaimingId(suggestion.userId);
    try {
      await api('/auth/claim-named-profile', {
        method: 'POST',
        body: JSON.stringify({ placeholderUserId: suggestion.userId }),
      });
      Alert.alert('Linked', `Your prior activity as ${suggestion.name} is on this account.`);
      setLinkSuggestions((prev) => (prev ?? []).filter((s) => s.userId !== suggestion.userId));
    } catch (err) {
      Alert.alert('Could not link', err instanceof Error ? err.message : 'Try again later.');
    } finally {
      setClaimingId(null);
    }
  };

  const submit = async () => {
    if (!validate()) return;
    setFormError(null);
    setLoading(true);
    try {
      const result = await api<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), password }),
        skipRefresh: true,
      });
      await storeSession(result);
      if (result.linkSuggestions && result.linkSuggestions.length > 0) {
        setLinkSuggestions(result.linkSuggestions);
        return;
      }
      finish();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign up failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (linkSuggestions) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink }}>Is this you?</Text>
          <Text style={{ fontSize: 15, color: colors.inkSecondary }}>
            WhatsApp already RSVP’d under a matching name. Link to keep that history. LID/phone
            still attach when you message the group.
          </Text>
        </View>
        {linkSuggestions.map((suggestion) => (
          <View
            key={suggestion.userId}
            style={{
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 12,
              padding: spacing.lg,
              gap: 8,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{suggestion.name}</Text>
            {suggestion.clues.slice(0, 3).map((clue) => (
              <Text key={clue.eventId} style={{ fontSize: 13, color: colors.inkSecondary, lineHeight: 18 }}>
                {clue.summary}
              </Text>
            ))}
            <Button
              title="Yes, link this profile"
              loading={claimingId === suggestion.userId}
              onPress={() => void claim(suggestion)}
            />
          </View>
        ))}
        <Button title="Continue" variant="secondary" onPress={finish} />
        <Pressable onPress={finish}>
          <Text style={{ textAlign: 'center', color: colors.inkTertiary, fontSize: 13 }}>Not now</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink }}>Join MKE Plays</Text>
          <Text style={{ fontSize: 15, color: colors.inkSecondary }}>
            Name, phone, password — then link WhatsApp from your tennis group.
          </Text>
        </View>

        <TextField
          label="Full name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          placeholder="Alex Rivera"
          error={errors.name}
        />
        <TextField
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          autoComplete="tel"
          keyboardType="phone-pad"
          placeholder="+1 414 555 0100"
          error={errors.phone}
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password-new"
          placeholder="8+ characters, mixed case, a number"
          error={errors.password}
          onSubmitEditing={() => void submit()}
        />

        {formError && (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {formError}
          </Text>
        )}

        <Button title="Create account" size="lg" loading={loading} onPress={() => void submit()} />
        <Button
          title="Already a member? Sign in"
          variant="ghost"
          onPress={() => {
            router.dismiss();
            router.push('/login');
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

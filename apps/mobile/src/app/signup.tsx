import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { api, storeSession } from '@/lib/api';
import { spacing, useTheme } from '@/lib/theme';
import type { User } from '@/lib/types';

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export default function SignupScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 10) next.password = 'Use at least 10 characters.';
    else if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password))
      next.password = 'Include upper and lower case letters and a number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setFormError(null);
    setLoading(true);
    try {
      const result = await api<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
        skipRefresh: true,
      });
      await storeSession(result);
      router.dismissAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign up failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink }}>Join Gatherly</Text>
          <Text style={{ fontSize: 15, color: colors.inkSecondary }}>
            Discover communities and events near you — free.
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
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          error={errors.email}
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          placeholder="At least 10 characters"
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
          title="Already have an account? Sign in"
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

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

export default function LoginScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
        skipRefresh: true,
      });
      await storeSession(result);
      router.dismissAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Try again.');
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
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink }}>Welcome back</Text>
          <Text style={{ fontSize: 15, color: colors.inkSecondary }}>
            Sign in to pick up where you left off.
          </Text>
        </View>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          placeholder="••••••••"
          onSubmitEditing={() => void submit()}
        />

        {error && (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {error}
          </Text>
        )}

        <Button title="Sign in" size="lg" loading={loading} onPress={() => void submit()} />
        <Button
          title="New here? Create an account"
          variant="ghost"
          onPress={() => {
            router.dismiss();
            router.push('/signup');
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

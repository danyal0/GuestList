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
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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

import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { api, clearSession } from '@/lib/api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { ProfileView } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

export default function ProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuthStore();

  const profile = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => api<ProfileView>(`/profiles/${user!.id}`),
    enabled: !!user,
  });
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (hydrated && !user) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="person-circle-outline"
          title="Welcome to MKE Plays"
          description="Sign in to join communities, RSVP to events, and message your people."
          actionTitle="Sign in"
          onAction={() => router.push('/login')}
        />
        <View style={{ alignItems: 'center' }}>
          <Button title="Create an account" variant="ghost" onPress={() => router.push('/signup')} />
        </View>
      </View>
    );
  }
  if (!user) return null;

  const stats = profile.data?.stats;

  const logout = async () => {
    await clearSession();
    queryClient.clear();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: 48 }}>
      {/* Identity */}
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Avatar uri={user.avatarUrl} name={user.name} size={88} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink }}>{user.name}</Text>
          {user.location && (
            <Text style={{ fontSize: 14, color: colors.inkSecondary }}>{user.location}</Text>
          )}
          {user.role === 'ADMIN' && <Badge label="Admin" tone="accent" />}
        </View>
        {user.bio && (
          <Text style={{ fontSize: 15, color: colors.inkSecondary, textAlign: 'center', lineHeight: 21 }}>
            {user.bio}
          </Text>
        )}
      </View>

      {/* Stats */}
      {stats && (
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingVertical: spacing.lg,
          }}
        >
          <Stat label="Communities" value={stats.groupsJoined} colors={colors} />
          <Stat label="Events" value={stats.eventsAttended} colors={colors} />
          <Stat label="Friends" value={stats.friends} colors={colors} />
        </View>
      )}

      {/* Interests */}
      {Array.isArray(user.interests) && user.interests.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Interests</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {user.interests.map((interest) => (
              <Badge key={interest} label={interest} tone="neutral" />
            ))}
          </View>
        </View>
      )}

      {/* Menu */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          overflow: 'hidden',
        }}
      >
        <MenuRow
          icon="notifications-outline"
          label="Notifications"
          badgeCount={unread.data?.count}
          onPress={() => router.push('/notifications')}
          colors={colors}
        />
        <View style={{ height: 1, backgroundColor: colors.hairline }} />
        <MenuRow
          icon="mail-outline"
          label={user.emailVerified ? 'Email verified' : 'Email not verified'}
          colors={colors}
        />
      </View>

      <Button title="Sign out" variant="secondary" onPress={() => void logout()} />
    </ScrollView>
  );
}

function Stat({ label, value, colors }: { label: string; value: number; colors: { ink: string; inkSecondary: string } }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: 12, color: colors.inkSecondary }}>{label}</Text>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  badgeCount,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badgeCount?: number;
  onPress?: () => void;
  colors: { ink: string; inkSecondary: string; accent: string; surface2: string };
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        backgroundColor: pressed ? colors.surface2 : 'transparent',
      })}
    >
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={{ flex: 1, fontSize: 16, color: colors.ink }}>{label}</Text>
      {typeof badgeCount === 'number' && badgeCount > 0 && (
        <View
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 6,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{badgeCount}</Text>
        </View>
      )}
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.inkSecondary} />}
    </Pressable>
  );
}

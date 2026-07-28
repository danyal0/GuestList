import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { ProfileView } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();

  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api<ProfileView>(`/profiles/${id}`),
  });

  const message = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/messaging/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ userId: id }),
      }),
    onSuccess: (conversation) => router.push(`/conversation/${conversation.id}`),
  });

  if (profile.isPending) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md, alignItems: 'center' }}>
        <Skeleton height={88} width={88} style={{ borderRadius: 44 }} />
        <Skeleton height={26} width="50%" />
        <Skeleton height={60} width="100%" />
      </View>
    );
  }
  if (profile.isError) return <ErrorState onRetry={() => profile.refetch()} />;

  const { user: person, stats } = profile.data;
  const isSelf = user?.id === person.id;
  const interests = Array.isArray(person.interests) ? person.interests : [];
  const skills = Array.isArray(person.skills) ? person.skills : [];

  return (
    <>
      <Stack.Screen options={{ title: person.name || 'Member' }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: 48 }}>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <Avatar uri={person.avatarUrl} name={person.name || 'Member'} size={88} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink }}>
              {person.name || 'Member'}
            </Text>
            {person.location && <Text style={{ fontSize: 14, color: colors.inkSecondary }}>{person.location}</Text>}
          </View>
          {person.bio && (
            <Text style={{ fontSize: 15, color: colors.inkSecondary, textAlign: 'center', lineHeight: 21 }}>
              {person.bio}
            </Text>
          )}
          {!isSelf && user && (
            <Button title="Message" loading={message.isPending} onPress={() => message.mutate()} />
          )}
        </View>

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
          {[
            { label: 'Communities', value: stats.groupsJoined },
            { label: 'Events', value: stats.eventsAttended },
            { label: 'Friends', value: stats.friends },
          ].map((stat) => (
            <View key={stat.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{stat.value}</Text>
              <Text style={{ fontSize: 12, color: colors.inkSecondary }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {interests.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Interests</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {interests.map((interest) => (
                <Badge key={interest} label={interest} tone="neutral" />
              ))}
            </View>
          </View>
        )}
        {skills.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Skills</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {skills.map((skill) => (
                <Badge key={skill} label={skill} tone="accent" />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </>
  );
}

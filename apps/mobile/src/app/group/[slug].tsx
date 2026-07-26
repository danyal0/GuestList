import { ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EventCard } from '@/components/event-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { absoluteUrl, api } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { EventSummary, GroupDetail, Paginated } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

export default function GroupScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const group = useQuery({
    queryKey: ['group', slug],
    queryFn: () => api<GroupDetail>(`/groups/${slug}`),
  });
  const events = useQuery({
    queryKey: ['group-events', group.data?.id],
    queryFn: () => api<Paginated<EventSummary>>(`/events?groupId=${group.data!.id}&limit=10`),
    enabled: !!group.data?.id,
  });

  const join = useMutation({
    mutationFn: () => api<{ status: string }>(`/groups/${group.data!.id}/join`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['group', slug] }),
  });
  const leave = useMutation({
    mutationFn: () => api(`/groups/${group.data!.id}/leave`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['group', slug] }),
  });

  if (group.isPending) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={180} />
        <Skeleton height={28} width="70%" />
        <Skeleton height={60} />
      </View>
    );
  }
  if (group.isError) return <ErrorState onRetry={() => group.refetch()} />;

  const g = group.data;
  const cover = absoluteUrl(g.coverImage);
  const isMember = !!g.viewerMembership;

  const membershipAction = () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (isMember) leave.mutate();
    else join.mutate();
  };

  return (
    <>
      <Stack.Screen options={{ title: g.name }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: '100%', height: 200 }} contentFit="cover" />
        ) : (
          <View style={{ width: '100%', height: 140, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="people-outline" size={40} color={colors.accent} />
          </View>
        )}

        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4, flexShrink: 1 }}>
                {g.name}
              </Text>
              {g.isVerified && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge label={CATEGORY_LABELS[g.category]} tone="neutral" />
              <Text style={{ fontSize: 13, color: colors.inkSecondary }}>
                {g.memberCount} members · {g.upcomingEvents} upcoming
              </Text>
              {g.privacy !== 'PUBLIC' && <Badge label={g.privacy === 'PRIVATE' ? 'Private' : 'Hidden'} tone="warning" />}
            </View>
            {g.location && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={14} color={colors.inkTertiary} />
                <Text style={{ fontSize: 13, color: colors.inkSecondary }}>{g.location}</Text>
              </View>
            )}
          </View>

          {/* Membership action */}
          {g.viewerPending ? (
            <Button title="Request pending" variant="secondary" disabled />
          ) : g.viewerMembership?.role === 'OWNER' ? (
            <Button title="You own this community" variant="secondary" disabled />
          ) : (
            <Button
              title={isMember ? 'Leave community' : g.privacy === 'PRIVATE' ? 'Request to join' : 'Join community'}
              variant={isMember ? 'secondary' : 'primary'}
              loading={join.isPending || leave.isPending}
              onPress={membershipAction}
            />
          )}

          {/* About */}
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>About</Text>
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.inkSecondary }}>{g.description}</Text>
          </View>

          {g.rules && (
            <View
              style={{
                gap: 6,
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.hairline,
                padding: spacing.lg,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>Community rules</Text>
              <Text style={{ fontSize: 14, lineHeight: 21, color: colors.inkSecondary }}>{g.rules}</Text>
            </View>
          )}

          {/* Events */}
          <View style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Upcoming events</Text>
            {events.isPending ? (
              <Skeleton height={120} />
            ) : (events.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon="calendar-outline" title="No upcoming events" description="Check back soon." />
            ) : (
              <View style={{ gap: spacing.md }}>
                {events.data!.items.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </>
  );
}

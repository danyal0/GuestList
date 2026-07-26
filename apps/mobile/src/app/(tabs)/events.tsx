import * as React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { EventCard } from '@/components/event-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { EventSummary, Paginated } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

type Filter = 'all' | 'mine';

export default function EventsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const [filter, setFilter] = React.useState<Filter>('all');

  const browse = useQuery({
    queryKey: ['events-browse'],
    queryFn: () => api<Paginated<EventSummary>>('/events?limit=20&sort=soonest'),
  });
  const mine = useQuery({
    queryKey: ['events-mine'],
    queryFn: () => api<EventSummary[]>('/events/mine'),
    enabled: !!user && filter === 'mine',
  });

  const active = filter === 'all' ? browse : mine;
  const items: EventSummary[] =
    filter === 'all' ? (browse.data?.items ?? []) : (mine.data ?? []);

  return (
    <View style={{ flex: 1 }}>
      {/* Segmented control */}
      <View
        style={{
          flexDirection: 'row',
          margin: spacing.lg,
          padding: 3,
          borderRadius: radius.md,
          backgroundColor: colors.surface3,
        }}
      >
        {(['all', 'mine'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === value }}
            onPress={() => {
              if (value === 'mine' && !user) {
                router.push('/login');
                return;
              }
              setFilter(value);
            }}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: radius.sm,
              backgroundColor: filter === value ? colors.surface : 'transparent',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: filter === value ? colors.ink : colors.inkSecondary }}>
              {value === 'all' ? 'Browse' : 'My events'}
            </Text>
          </Pressable>
        ))}
      </View>

      {active.isPending ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={120} />
          ))}
        </View>
      ) : active.isError ? (
        <ErrorState onRetry={() => active.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title={filter === 'mine' ? 'No events yet' : 'No upcoming events'}
          description={
            filter === 'mine'
              ? 'RSVP to an event and it will show up here.'
              : 'Check back soon — new events are added all the time.'
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EventCard event={item} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 48, gap: spacing.md }}
          refreshing={active.isRefetching}
          onRefresh={() => active.refetch()}
        />
      )}
    </View>
  );
}

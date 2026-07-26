import * as React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { CommunityCard } from '@/components/community-card';
import { EventCard } from '@/components/event-card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { EventSummary, Group, GroupCategory, Paginated } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

const FEATURED_CATEGORIES: GroupCategory[] = [
  'TECHNOLOGY', 'OUTDOORS', 'ARTS', 'SPORTS', 'FOOD', 'BOOKS', 'MUSIC', 'GAMES',
];

export default function DiscoverScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const [search, setSearch] = React.useState('');

  const events = useQuery({
    queryKey: ['discover-events'],
    queryFn: () => api<Paginated<EventSummary>>('/events?limit=6&sort=soonest'),
  });
  const groups = useQuery({
    queryKey: ['discover-groups'],
    queryFn: () => api<Paginated<Group>>('/groups?limit=6&sort=popular'),
  });
  const recommendations = useQuery({
    queryKey: ['recommended-events'],
    queryFn: () => api<EventSummary[]>('/recommendations/events?limit=4'),
    enabled: !!user,
  });

  const refreshing = events.isRefetching || groups.isRefetching;
  const onRefresh = () => {
    void events.refetch();
    void groups.refetch();
    if (user) void recommendations.refetch();
  };

  const submitSearch = () => {
    const q = search.trim();
    if (q) router.push({ pathname: '/search', params: { q } });
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      {/* Greeting + search */}
      <View style={{ gap: spacing.md }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 }}>
          {user ? `Hi ${user.name.split(' ')[0]} 👋` : 'Find your people'}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.surface,
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingHorizontal: spacing.lg,
          }}
        >
          <Ionicons name="search" size={18} color={colors.inkTertiary} />
          <TextInput
            accessibilityLabel="Search communities, events and people"
            placeholder="Search communities, events, people…"
            placeholderTextColor={colors.inkTertiary}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: colors.ink }}
          />
        </View>
      </View>

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FEATURED_CATEGORIES.map((category) => (
          <Pressable
            key={category}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/search', params: { q: CATEGORY_LABELS[category] } })}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.accentSoft : colors.surface,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: 14,
              paddingVertical: 8,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
              {CATEGORY_LABELS[category]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Recommendations */}
      {user && (recommendations.data?.length ?? 0) > 0 && (
        <Section title="Picked for you" colors={colors}>
          <View style={{ gap: spacing.md }}>
            {recommendations.data!.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </View>
        </Section>
      )}

      {/* Upcoming events */}
      <Section title="Happening soon" colors={colors}>
        {events.isPending ? (
          <SkeletonList />
        ) : events.isError ? (
          <ErrorState onRetry={() => events.refetch()} />
        ) : (
          <View style={{ gap: spacing.md }}>
            {events.data.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </View>
        )}
      </Section>

      {/* Popular communities */}
      <Section title="Popular communities" colors={colors}>
        {groups.isPending ? (
          <SkeletonList />
        ) : groups.isError ? (
          <ErrorState onRetry={() => groups.refetch()} />
        ) : (
          <View style={{ gap: spacing.md }}>
            {groups.data.items.map((group) => (
              <CommunityCard key={group.id} group={group} />
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  colors,
  children,
}: {
  title: string;
  colors: { ink: string };
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 }}>{title}</Text>
      {children}
    </View>
  );
}

function SkeletonList() {
  return (
    <View style={{ gap: spacing.md }}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={120} />
      ))}
    </View>
  );
}

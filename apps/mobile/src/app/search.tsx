import * as React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { CommunityCard } from '@/components/community-card';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { SearchResults } from '@/lib/types';

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const [input, setInput] = React.useState(params.q ?? '');
  const [query, setQuery] = React.useState(params.q ?? '');

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });

  const total = results.data
    ? results.data.groups.length + results.data.events.length + results.data.users.length
    : 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Search' }} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
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
            accessibilityLabel="Search"
            placeholder="Communities, events, people…"
            placeholderTextColor={colors.inkTertiary}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => setQuery(input.trim())}
            returnKeyType="search"
            autoFocus={!params.q}
            style={{ flex: 1, paddingVertical: 12, fontSize: 15, color: colors.ink }}
          />
        </View>

        {!query ? (
          <EmptyState icon="search-outline" title="Search MKE Plays" description="Communities, events and people — all in one place." />
        ) : results.isPending ? (
          <View style={{ gap: spacing.md }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={80} />
            ))}
          </View>
        ) : results.isError ? (
          <ErrorState onRetry={() => results.refetch()} />
        ) : total === 0 ? (
          <EmptyState icon="search-outline" title={`No results for “${query}”`} description="Try different keywords." />
        ) : (
          <View style={{ gap: spacing.xl }}>
            {results.data.groups.length > 0 && (
              <View style={{ gap: spacing.md }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Communities</Text>
                {results.data.groups.map((group) => (
                  <CommunityCard key={group.id} group={group} />
                ))}
              </View>
            )}
            {results.data.events.length > 0 && (
              <View style={{ gap: spacing.md }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Events</Text>
                {results.data.events.map((event) => (
                  <Pressable
                    key={event.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/event/${event.id}`)}
                    style={({ pressed }) => ({
                      backgroundColor: pressed ? colors.surface2 : colors.surface,
                      borderRadius: radius.lg,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      padding: spacing.lg,
                      gap: 2,
                    })}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accent }}>{event.groupName}</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{event.title}</Text>
                    <Text style={{ fontSize: 13, color: colors.inkSecondary }}>
                      {formatDateTime(event.startTime)}
                      {event.locationName ? ` · ${event.locationName}` : ''} · {event.goingCount} going
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {results.data.users.length > 0 && (
              <View style={{ gap: spacing.md }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>People</Text>
                {results.data.users.map((person) => (
                  <Pressable
                    key={person.id}
                    accessibilityRole="button"
                    onPress={() => router.push(`/user/${person.id}`)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      backgroundColor: pressed ? colors.surface2 : colors.surface,
                      borderRadius: radius.lg,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      padding: spacing.md,
                    })}
                  >
                    <Avatar uri={person.avatarUrl} name={person.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{person.name}</Text>
                      {person.location && (
                        <Text style={{ fontSize: 13, color: colors.inkTertiary }}>{person.location}</Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

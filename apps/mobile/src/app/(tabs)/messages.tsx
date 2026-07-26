import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { spacing, useTheme } from '@/lib/theme';
import type { Conversation } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

export default function MessagesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user, hydrated } = useAuthStore();

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/messaging/conversations'),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (hydrated && !user) {
    return (
      <EmptyState
        icon="chatbubbles-outline"
        title="Sign in to see your messages"
        description="Chat with friends and your communities."
        actionTitle="Sign in"
        onAction={() => router.push('/login')}
      />
    );
  }

  const nameFor = (c: Conversation): { name: string; avatarUrl: string | null } => {
    if (c.type === 'GROUP')
      return { name: c.title ?? c.group?.name ?? 'Community chat', avatarUrl: c.group?.coverImage ?? null };
    const other = c.participants.find((p) => p.userId !== user?.id)?.user;
    return { name: other?.name ?? 'Conversation', avatarUrl: other?.avatarUrl ?? null };
  };

  return conversations.isPending ? (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={72} />
      ))}
    </View>
  ) : conversations.isError ? (
    <ErrorState onRetry={() => conversations.refetch()} />
  ) : conversations.data.length === 0 ? (
    <EmptyState
      icon="chatbubbles-outline"
      title="No conversations yet"
      description="Visit a member's profile to say hi, or open your community's chat."
    />
  ) : (
    <FlatList
      data={conversations.data}
      keyExtractor={(item) => item.id}
      refreshing={conversations.isRefetching}
      onRefresh={() => conversations.refetch()}
      renderItem={({ item }) => {
        const { name, avatarUrl } = nameFor(item);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Conversation with ${name}`}
            onPress={() => router.push(`/conversation/${item.id}`)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              backgroundColor: pressed ? colors.surface2 : 'transparent',
            })}
          >
            <Avatar uri={avatarUrl} name={name} size={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
                  {name}
                </Text>
                {item.lastMessage && (
                  <Text style={{ fontSize: 12, color: colors.inkTertiary }}>
                    {formatRelative(item.lastMessage.createdAt)}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 14, color: colors.inkSecondary }} numberOfLines={1}>
                {item.lastMessage
                  ? `${item.lastMessage.sender.id === user?.id ? 'You: ' : ''}${item.lastMessage.content}`
                  : 'Say hello 👋'}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View
                accessibilityLabel={`${item.unreadCount} unread`}
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
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{item.unreadCount}</Text>
              </View>
            )}
          </Pressable>
        );
      }}
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: colors.hairline, marginLeft: spacing.lg + 48 + spacing.md }} />
      )}
    />
  );
}

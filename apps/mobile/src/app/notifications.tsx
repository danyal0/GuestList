import { FlatList, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { spacing, useTheme } from '@/lib/theme';
import type { Notification, Paginated } from '@/lib/types';

function describe(notification: Notification): { title: string; icon: keyof typeof Ionicons.glyphMap } {
  const p = notification.payload as Record<string, string | undefined>;
  switch (notification.type) {
    case 'NEW_MEMBER':
      return { title: `${p.memberName ?? 'Someone'} joined ${p.groupName ?? 'your community'}`, icon: 'person-add-outline' };
    case 'EVENT_REMINDER':
      return { title: `Reminder: ${p.eventTitle ?? 'your event'} is coming up`, icon: 'alarm-outline' };
    case 'RSVP_CONFIRMATION':
      return { title: `You're confirmed for ${p.eventTitle ?? 'the event'}`, icon: 'checkmark-circle-outline' };
    case 'WAITLIST_PROMOTED':
      return { title: `A spot opened up — you're in for ${p.eventTitle ?? 'the event'}!`, icon: 'sparkles-outline' };
    case 'MESSAGE_RECEIVED':
      return { title: `New message from ${p.senderName ?? 'someone'}`, icon: 'chatbubble-outline' };
    case 'COMMUNITY_UPDATE':
      return { title: p.message ?? `Update from ${p.groupName ?? 'your community'}`, icon: 'megaphone-outline' };
    case 'FRIEND_REQUEST':
      return { title: `${p.senderName ?? 'Someone'} sent you a friend request`, icon: 'people-outline' };
    case 'FRIEND_ACCEPTED':
      return { title: `${p.senderName ?? 'Someone'} accepted your friend request`, icon: 'people-outline' };
    case 'EVENT_CANCELLED':
      return { title: `${p.eventTitle ?? 'An event'} was cancelled`, icon: 'close-circle-outline' };
    case 'EVENT_UPDATED':
      return { title: `${p.eventTitle ?? 'An event'} was updated`, icon: 'refresh-outline' };
    case 'MEMBERSHIP_APPROVED':
      return { title: `You're in! ${p.groupName ?? 'The community'} approved your request`, icon: 'checkmark-done-outline' };
    default:
      return { title: 'You have a new notification', icon: 'notifications-outline' };
  }
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Paginated<Notification>>('/notifications?limit=50'),
  });

  const markAllRead = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const hasUnread = notifications.data?.items.some((n) => !n.read) ?? false;

  return notifications.isPending ? (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} height={64} />
      ))}
    </View>
  ) : notifications.isError ? (
    <ErrorState onRetry={() => notifications.refetch()} />
  ) : notifications.data.items.length === 0 ? (
    <EmptyState
      icon="notifications-outline"
      title="You're all caught up"
      description="Notifications about your communities and events will appear here."
    />
  ) : (
    <FlatList
      data={notifications.data.items}
      keyExtractor={(item) => item.id}
      refreshing={notifications.isRefetching}
      onRefresh={() => notifications.refetch()}
      ListHeaderComponent={
        hasUnread ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Button
              title="Mark all read"
              variant="ghost"
              size="sm"
              loading={markAllRead.isPending}
              onPress={() => markAllRead.mutate()}
            />
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const { title, icon } = describe(item);
        return (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              backgroundColor: item.read ? 'transparent' : colors.accentSoft,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={icon} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, color: colors.ink, fontWeight: item.read ? '400' : '600' }}>
                {title}
              </Text>
              <Text style={{ fontSize: 12, color: colors.inkTertiary }}>{formatRelative(item.createdAt)}</Text>
            </View>
          </View>
        );
      }}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.hairline }} />}
      contentContainerStyle={{ paddingBottom: 32 }}
    />
  );
}

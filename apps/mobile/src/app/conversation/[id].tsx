import * as React from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Conversation, Message } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

interface MessagePage {
  items: Message[];
  nextCursor?: string;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [draft, setDraft] = React.useState('');
  const listRef = React.useRef<FlatList<Message>>(null);

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/messaging/conversations'),
    enabled: !!user,
  });
  const conversation = conversations.data?.find((c) => c.id === id);

  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<MessagePage>(`/messaging/conversations/${id}/messages?limit=50`),
  });

  // Real-time: join the conversation room and append incoming messages.
  React.useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('conversation:join', { conversationId: id });
    const onMessage = (message: Message) => {
      if (message.conversationId !== id) return;
      queryClient.setQueryData<MessagePage>(['messages', id], (old) =>
        old && !old.items.some((m) => m.id === message.id)
          ? { ...old, items: [...old.items, message] }
          : old,
      );
    };
    socket.on('message', onMessage);
    return () => {
      socket.emit('conversation:leave', { conversationId: id });
      socket.off('message', onMessage);
    };
  }, [id, queryClient]);

  // Mark as read when opened.
  React.useEffect(() => {
    if (!messages.isSuccess) return;
    void api(`/messaging/conversations/${id}/read`, { method: 'POST', body: '{}' }).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [id, messages.isSuccess, queryClient]);

  const send = useMutation({
    mutationFn: (content: string) =>
      api<Message>(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: (message) => {
      queryClient.setQueryData<MessagePage>(['messages', id], (old) =>
        old && !old.items.some((m) => m.id === message.id)
          ? { ...old, items: [...old.items, message] }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const title =
    conversation?.type === 'GROUP'
      ? (conversation.title ?? conversation.group?.name ?? 'Chat')
      : (conversation?.participants.find((p) => p.userId !== user?.id)?.user.name ?? 'Chat');

  const submit = () => {
    const content = draft.trim();
    if (!content || send.isPending) return;
    setDraft('');
    send.mutate(content);
  };

  return (
    <>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        style={{ flex: 1 }}
      >
        {messages.isPending ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} width={i % 2 ? '60%' : '75%'} style={{ alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />
            ))}
          </View>
        ) : messages.isError ? (
          <ErrorState onRetry={() => messages.refetch()} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages.data.items}
            keyExtractor={(item) => item.id}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            contentContainerStyle={{ padding: spacing.lg, gap: 6 }}
            renderItem={({ item, index }) => {
              const mine = item.senderId === user?.id;
              const items = messages.data.items;
              const showSender =
                !mine &&
                conversation?.type === 'GROUP' &&
                (index === 0 || items[index - 1]?.senderId !== item.senderId);
              return (
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: mine ? 'flex-end' : 'flex-start',
                    gap: 8,
                    alignItems: 'flex-end',
                  }}
                >
                  {!mine && <Avatar uri={item.sender.avatarUrl} name={item.sender.name} size={26} />}
                  <View style={{ maxWidth: '75%' }}>
                    {showSender && (
                      <Text style={{ fontSize: 11, color: colors.inkTertiary, marginLeft: 12, marginBottom: 2 }}>
                        {item.sender.name}
                      </Text>
                    )}
                    <View
                      style={{
                        backgroundColor: mine ? colors.accent : colors.surface2,
                        borderRadius: radius.lg,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                      }}
                    >
                      <Text style={{ fontSize: 15, lineHeight: 20, color: mine ? '#fff' : colors.ink }}>
                        {item.content}
                      </Text>
                      <Text
                        style={{
                          fontSize: 10,
                          marginTop: 2,
                          color: mine ? 'rgba(255,255,255,0.7)' : colors.inkTertiary,
                          alignSelf: 'flex-end',
                        }}
                      >
                        {formatTime(item.createdAt)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Composer */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            backgroundColor: colors.background,
          }}
        >
          <TextInput
            accessibilityLabel="Message"
            placeholder="Message…"
            placeholderTextColor={colors.inkTertiary}
            value={draft}
            onChangeText={setDraft}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              backgroundColor: colors.surface2,
              borderRadius: radius.lg,
              paddingHorizontal: 14,
              paddingVertical: 10,
              fontSize: 15,
              color: colors.ink,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!draft.trim() || send.isPending}
            onPress={submit}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: draft.trim() ? colors.accent : colors.surface3,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="arrow-up" size={20} color={draft.trim() ? '#fff' : colors.inkTertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

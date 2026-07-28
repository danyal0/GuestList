import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { absoluteUrl, api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { radius, spacing, useTheme, type ThemeColors } from '@/lib/theme';
import type { EventDetail, RsvpStatus } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

const RSVP_OPTIONS: { status: RsvpStatus; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { status: 'GOING', label: 'Going', icon: 'checkmark' },
  { status: 'INTERESTED', label: 'Interested', icon: 'star-outline' },
  { status: 'DECLINED', label: "Can't go", icon: 'close' },
];

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [notice, setNotice] = React.useState<string | null>(null);

  const event = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<EventDetail>(`/events/${id}`),
  });

  const rsvp = useMutation({
    mutationFn: (status: RsvpStatus) =>
      api<{ rsvp: { status: RsvpStatus }; waitlisted: boolean }>(`/events/${id}/rsvp`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: ['event', id] });
      const previous = queryClient.getQueryData<EventDetail>(['event', id]);
      queryClient.setQueryData<EventDetail>(['event', id], (old) =>
        old ? { ...old, viewerRsvp: { status } } : old,
      );
      return { previous };
    },
    onError: (error, _status, context) => {
      if (context?.previous) queryClient.setQueryData(['event', id], context.previous);
      setNotice(error instanceof Error ? error.message : 'Could not update your RSVP');
    },
    onSuccess: (data) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setNotice(
        data.waitlisted
          ? "This event is full — you're on the waitlist."
          : data.rsvp.status === 'GOING'
            ? "You're going! 🎉"
            : null,
      );
      void queryClient.invalidateQueries({ queryKey: ['event', id] });
      void queryClient.invalidateQueries({ queryKey: ['events-mine'] });
    },
  });

  if (event.isPending) {
    return (
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Skeleton height={200} />
        <Skeleton height={28} width="80%" />
        <Skeleton height={90} />
      </View>
    );
  }
  if (event.isError) return <ErrorState onRetry={() => event.refetch()} />;

  const e = event.data;
  const cover = absoluteUrl(e.coverImage);
  const current = e.viewerRsvp?.status;
  const started = new Date(e.startTime) < new Date();
  const closed =
    e.status !== 'PUBLISHED' || started || (e.rsvpDeadline ? new Date(e.rsvpDeadline) < new Date() : false);

  const handleRsvp = (status: RsvpStatus) => {
    if (!user) {
      router.push('/login');
      return;
    }
    rsvp.mutate(status);
  };

  return (
    <>
      <Stack.Screen options={{ title: e.title }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 64 }}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: '100%', height: 220 }} contentFit="cover" />
        ) : (
          <View style={{ width: '100%', height: 140, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="calendar-outline" size={40} color={colors.accent} />
          </View>
        )}

        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/group/${e.group.slug}`)}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>
                {e.group.name.toUpperCase()}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 }}>
              {e.title}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {e.status === 'CANCELLED' && <Badge label="Cancelled" tone="danger" />}
              {e.mode === 'ONLINE' && <Badge label="Online" tone="accent" />}
              {e.mode === 'HYBRID' && <Badge label="Hybrid" tone="accent" />}
              {current === 'WAITLISTED' && <Badge label="You're waitlisted" tone="warning" />}
            </View>
          </View>

          {/* Key facts */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.hairline,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <FactRow icon="time-outline" colors={colors}>
              {formatDate(e.startTime)} · {formatTime(e.startTime)} – {formatTime(e.endTime)}
            </FactRow>
            {e.locationName && (
              <FactRow icon="location-outline" colors={colors}>
                {e.locationName}
                {e.address ? ` — ${e.address}` : ''}
              </FactRow>
            )}
            {e.mode !== 'IN_PERSON' && e.onlineUrl && (
              <FactRow icon="videocam-outline" colors={colors}>
                Online — link shared with attendees
              </FactRow>
            )}
            <FactRow icon="people-outline" colors={colors}>
              {e.goingCount} going · {e.interestedCount} interested
              {typeof e.capacity === 'number' && Number.isFinite(e.capacity)
                ? ` · ${e.capacity} max`
                : ''}
              {e.waitlistCount > 0 && ` · ${e.waitlistCount} waitlisted`}
            </FactRow>
          </View>

          {/* RSVP */}
          {closed ? (
            <View style={{ backgroundColor: colors.surface3, borderRadius: radius.md, padding: spacing.lg }}>
              <Text style={{ textAlign: 'center', fontSize: 14, fontWeight: '600', color: colors.inkSecondary }}>
                {e.status === 'CANCELLED'
                  ? 'This event was cancelled'
                  : started
                    ? 'This event has started'
                    : 'RSVPs are closed'}
              </Text>
            </View>
          ) : (
            <View accessibilityRole="radiogroup" accessibilityLabel="RSVP to this event" style={{ flexDirection: 'row', gap: 8 }}>
              {RSVP_OPTIONS.map(({ status, label, icon }) => {
                const active = current === status || (status === 'GOING' && current === 'WAITLISTED');
                const waitlisted = current === 'WAITLISTED' && status === 'GOING';
                return (
                  <Pressable
                    key={status}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, disabled: rsvp.isPending }}
                    disabled={rsvp.isPending}
                    onPress={() => handleRsvp(status)}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 46,
                      borderRadius: radius.md,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      backgroundColor: active ? (waitlisted ? colors.warning : colors.accent) : colors.surface,
                      borderWidth: active ? 0 : 1,
                      borderColor: colors.hairline,
                      opacity: pressed || rsvp.isPending ? 0.7 : 1,
                    })}
                  >
                    <Ionicons
                      name={waitlisted ? 'hourglass-outline' : icon}
                      size={16}
                      color={active ? '#fff' : colors.ink}
                    />
                    <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#fff' : colors.ink }}>
                      {waitlisted ? 'Waitlisted' : label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {notice && (
            <Text accessibilityRole="alert" style={{ fontSize: 14, color: colors.inkSecondary, textAlign: 'center' }}>
              {notice}
            </Text>
          )}

          {/* About */}
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>About this event</Text>
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.inkSecondary }}>{e.description}</Text>
          </View>

          {/* Host + attendees */}
          <View style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Hosted by</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar uri={e.host.avatarUrl} name={e.host.name} size={44} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{e.host.name}</Text>
            </View>
          </View>

          {e.attendeePreview.length > 0 && (
            <View style={{ gap: spacing.md }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Who&apos;s coming</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {e.attendeePreview.map((attendee) => (
                  <Pressable
                    key={attendee.id}
                    accessibilityRole="button"
                    accessibilityLabel={attendee.name}
                    onPress={() => router.push(`/user/${attendee.id}`)}
                    style={{ alignItems: 'center', gap: 4, width: 64 }}
                  >
                    <Avatar uri={attendee.avatarUrl} name={attendee.name} size={48} />
                    <Text style={{ fontSize: 11, color: colors.inkSecondary }} numberOfLines={1}>
                      {attendee.name.split(' ')[0]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function FactRow({
  icon,
  colors,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  colors: ThemeColors;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Ionicons name={icon} size={18} color={colors.accent} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, fontSize: 15, color: colors.ink, lineHeight: 21 }}>{children}</Text>
    </View>
  );
}

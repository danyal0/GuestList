import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui/badge';
import { absoluteUrl } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { EventSummary } from '@/lib/types';

export function EventCard({ event }: { event: EventSummary }) {
  const { colors } = useTheme();
  const router = useRouter();
  const cover = absoluteUrl(event.coverImage);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${formatDateTime(event.startTime)}`}
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.hairline,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="calendar-outline" size={28} color={colors.accent} />
        </View>
      )}
      <View style={{ padding: spacing.lg, gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accent }} numberOfLines={1}>
          {event.group.name.toUpperCase()}
        </Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }} numberOfLines={2}>
          {event.title}
        </Text>
        <Text style={{ fontSize: 13, color: colors.inkSecondary }} numberOfLines={1}>
          {formatDateTime(event.startTime)}
          {event.mode === 'ONLINE' ? ' · Online' : event.locationName ? ` · ${event.locationName}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Text style={{ fontSize: 13, color: colors.inkTertiary }}>
            {event.goingCount} going
            {typeof event.spotsLeft === 'number' &&
            Number.isFinite(event.spotsLeft) &&
            event.spotsLeft <= 5 &&
            event.spotsLeft > 0
              ? ` · ${event.spotsLeft} spots left`
              : ''}
          </Text>
          {event.status === 'CANCELLED' && <Badge label="Cancelled" tone="danger" />}
          {event.rsvpStatus === 'GOING' && <Badge label="Going" tone="success" />}
          {event.rsvpStatus === 'WAITLISTED' && <Badge label="Waitlisted" tone="warning" />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 140 },
});

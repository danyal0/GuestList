import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui/badge';
import { absoluteUrl } from '@/lib/api';
import { CATEGORY_LABELS } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Group } from '@/lib/types';

export function CommunityCard({ group }: { group: Group }) {
  const { colors } = useTheme();
  const router = useRouter();
  const cover = absoluteUrl(group.coverImage);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${group.memberCount} members`}
      onPress={() => router.push(`/group/${group.slug}`)}
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
          <Ionicons name="people-outline" size={28} color={colors.accent} />
        </View>
      )}
      <View style={{ padding: spacing.lg, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
            {group.name}
          </Text>
          {group.isVerified && <Ionicons name="checkmark-circle" size={16} color={colors.accent} />}
        </View>
        <Text style={{ fontSize: 13, color: colors.inkSecondary }} numberOfLines={2}>
          {group.description}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <Badge label={CATEGORY_LABELS[group.category]} tone="neutral" />
          <Text style={{ fontSize: 13, color: colors.inkTertiary }}>{group.memberCount} members</Text>
          {group.privacy !== 'PUBLIC' && <Ionicons name="lock-closed-outline" size={13} color={colors.inkTertiary} />}
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
  cover: { width: '100%', height: 110 },
});

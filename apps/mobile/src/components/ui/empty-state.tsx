import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/button';
import { spacing, useTheme } from '@/lib/theme';

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  actionTitle,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: spacing.xl, gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>{title}</Text>
      {description && (
        <Text style={{ fontSize: 14, color: colors.inkSecondary, textAlign: 'center', lineHeight: 20 }}>
          {description}
        </Text>
      )}
      {actionTitle && onAction && <Button title={actionTitle} onPress={onAction} style={{ marginTop: 4 }} />}
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Something went wrong"
      description="We couldn't load this right now. Check your connection and try again."
      actionTitle={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}
